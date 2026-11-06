import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

/// Historial de viajes para el administrador.
///
/// Lee `historial_viajes`, la copia inmutable que el servidor guarda de
/// cada viaje cerrado (finalizado, cancelado, reasignado o de cuenta
/// eliminada). Solo un admin puede leerla (firestore.rules).
class AdminHistorialScreen extends StatefulWidget {
  const AdminHistorialScreen({super.key});

  @override
  State<AdminHistorialScreen> createState() => _AdminHistorialScreenState();
}

class _AdminHistorialScreenState extends State<AdminHistorialScreen> {
  static const _limite = 200;

  late final _stream = FirebaseFirestore.instance
      .collection('historial_viajes')
      .orderBy('archivadoEn', descending: true)
      .limit(_limite)
      .snapshots();

  String _filtro = 'todos';
  String _busqueda = '';

  static const _filtros = {
    'todos': 'Todos',
    'finalizado': 'Finalizados',
    'cancelado': 'Cancelados',
    'reasignado': 'Reasignados',
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Historial de viajes')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Buscar por paciente o chofer',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _busqueda = v.trim().toLowerCase()),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                for (final entrada in _filtros.entries)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(entrada.value),
                      selected: _filtro == entrada.key,
                      onSelected: (_) => setState(() => _filtro = entrada.key),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: _stream,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text('No se pudo cargar el historial: ${snapshot.error}'),
                    ),
                  );
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }

                final viajes = snapshot.data!.docs.where((d) {
                  final datos = d.data();
                  if (_filtro != 'todos' && datos['cierre'] != _filtro) return false;
                  if (_busqueda.isEmpty) return true;
                  final texto = '${datos['pacienteNombre'] ?? ''} ${datos['conductorNombre'] ?? ''}'.toLowerCase();
                  return texto.contains(_busqueda);
                }).toList();

                if (viajes.isEmpty) {
                  return const Center(
                    child: Text('No hay viajes en el historial.', style: TextStyle(fontSize: 16)),
                  );
                }

                return ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: viajes.length,
                  itemBuilder: (context, i) => _TarjetaHistorial(datos: viajes[i].data()),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TarjetaHistorial extends StatelessWidget {
  const _TarjetaHistorial({required this.datos});
  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final cierre = datos['cierre'] as String? ?? '';
    final paciente = datos['pacienteNombre'] as String? ?? '(sin nombre)';
    final chofer = datos['conductorNombre'] as String? ?? '(sin chofer)';
    final origen = datos['origenColeccion'] == 'solicitudes' ? 'Pedido por el paciente' : 'Asignado por el centro';

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        onTap: () => _mostrarDetalle(context),
        leading: _IconoCierre(cierre: cierre),
        title: Text(paciente, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('Chofer: $chofer\n${_fechaViaje(datos)} · $origen'),
        isThreeLine: true,
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }

  void _mostrarDetalle(BuildContext context) {
    final historial = (datos['historial'] as List?) ?? [];
    final gps = datos['gps'] as Map<String, dynamic>? ?? {};
    final necesidades = datos['necesidades'] as Map<String, dynamic>?;
    final origen = datos['origen'] as Map<String, dynamic>?;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (context, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              datos['pacienteNombre'] as String? ?? '(sin nombre)',
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            _Dato('Chofer', datos['conductorNombre'] as String? ?? '(sin chofer)'),
            _Dato('Resultado', _textoCierre(datos['cierre'] as String? ?? '')),
            _Dato('Fecha del viaje', _fechaViaje(datos)),
            _Dato('Archivado', _formatearIso(datos['archivadoEn'] as String?)),
            if (origen?['direccion'] != null) _Dato('Retiro', origen!['direccion'] as String),
            if (necesidades?['sillaRuedas'] == true) const _Dato('Movilidad', 'Necesita ayuda'),
            if (datos['notas'] != null) _Dato('Notas', datos['notas'] as String),
            _Dato('Puntos GPS registrados', '${gps['conteo'] ?? 0}'),
            const SizedBox(height: 16),
            const Text('Recorrido de estados', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            if (historial.isEmpty) const Text('Sin cambios de estado registrados.'),
            for (final entrada in historial)
              if (entrada is Map)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.circle, size: 12),
                  title: Text(_textoEstado(entrada['estado']?.toString() ?? '')),
                  trailing: Text(_formatearIso(entrada['fecha']?.toString())),
                ),
          ],
        ),
      ),
    );
  }
}

class _Dato extends StatelessWidget {
  const _Dato(this.etiqueta, this.valor);
  final String etiqueta;
  final String valor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text(etiqueta, style: const TextStyle(color: Colors.grey)),
          ),
          Expanded(child: Text(valor)),
        ],
      ),
    );
  }
}

class _IconoCierre extends StatelessWidget {
  const _IconoCierre({required this.cierre});
  final String cierre;

  @override
  Widget build(BuildContext context) {
    switch (cierre) {
      case 'finalizado':
        return const Icon(Icons.check_circle, color: Colors.green, size: 32);
      case 'cancelado':
        return const Icon(Icons.cancel, color: Colors.red, size: 32);
      case 'reasignado':
        return const Icon(Icons.swap_horiz, color: Colors.orange, size: 32);
      default:
        return const Icon(Icons.history, color: Colors.grey, size: 32);
    }
  }
}

String _fechaViaje(Map<String, dynamic> datos) {
  final fecha = datos['fecha'] as String?;
  final hora = datos['hora'] as String?;
  if (fecha != null) return hora != null ? '$fecha $hora' : fecha;
  return _formatearIso(datos['creadoEn'] as String?);
}

String _formatearIso(String? iso) {
  if (iso == null) return '—';
  final fecha = DateTime.tryParse(iso)?.toLocal();
  if (fecha == null) return iso;
  String dos(int n) => n.toString().padLeft(2, '0');
  return '${dos(fecha.day)}-${dos(fecha.month)}-${fecha.year} ${dos(fecha.hour)}:${dos(fecha.minute)}';
}

String _textoCierre(String cierre) {
  switch (cierre) {
    case 'finalizado':
      return 'Finalizado';
    case 'cancelado':
      return 'Cancelado';
    case 'reasignado':
      return 'Reasignado a otro chofer';
    case 'cuenta_eliminada':
      return 'Cuenta eliminada';
    default:
      return cierre;
  }
}

String _textoEstado(String estado) {
  if (estado.startsWith('rechazado:')) return 'Chofer devolvió la solicitud';
  const textos = {
    'solicitado': 'Solicitado',
    'asignado': 'Asignado',
    'conductor_en_camino': 'Chofer en camino',
    'conductor_llego': 'Chofer llegó',
    'en_viaje': 'En viaje',
    'finalizado': 'Finalizado',
    'cancelado': 'Cancelado',
  };
  return textos[estado] ?? estado;
}
