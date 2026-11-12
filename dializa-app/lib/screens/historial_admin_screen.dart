import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class HistorialAdminScreen extends StatefulWidget {
  const HistorialAdminScreen({super.key});
  @override
  State<HistorialAdminScreen> createState() => _HistorialAdminState();
}

class _HistorialAdminState extends State<HistorialAdminScreen> {
  final List<DocumentSnapshot<Map<String, dynamic>>> _cursores = [];
  @override
  Widget build(BuildContext context) {
    Query<Map<String, dynamic>> query = FirebaseFirestore.instance
        .collection('historial_viajes')
        .orderBy('archivadoEn', descending: true)
        .orderBy(FieldPath.documentId, descending: true)
        .limit(25);
    if (_cursores.isNotEmpty) query = query.startAfterDocument(_cursores.last);
    return Scaffold(
      appBar: AppBar(title: const Text('Historial de traslados')),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: query.snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return const Center(
              child: Text(
                'No se pudo consultar el historial. Revisa tu permiso de administrador.',
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final docs = snapshot.data!.docs;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (docs.isEmpty)
                const Text('No hay viajes archivados en esta pagina.'),
              ...docs.map((doc) {
                final d = doc.data();
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${d['pacienteNombre'] ?? 'Paciente'} — ${d['estadoFinal'] ?? ''}',
                        ),
                        Text(
                          'Chofer: ${d['conductorNombre'] ?? 'Sin nombre archivado'}',
                        ),
                        Text('Archivado: ${d['archivadoEn'] ?? ''}'),
                        Text('Instancia: ${doc.id}'),
                        TextButton.icon(
                          onPressed: () => mostrarDetalleHistorial(context, d),
                          icon: const Icon(Icons.history),
                          label: const Text('Ver detalle'),
                        ),
                        FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                          future: FirebaseFirestore.instance
                              .collection('gps_viajes')
                              .doc(doc.id)
                              .get(),
                          builder: (context, gps) {
                            if (gps.hasError) {
                              return const Text(
                                'No se pudo cargar el resumen GPS.',
                              );
                            }
                            if (!gps.hasData) {
                              return const Text('Cargando resumen GPS...');
                            }
                            return ResumenGps(datos: gps.data!.data());
                          },
                        ),
                      ],
                    ),
                  ),
                );
              }),
              Row(
                children: [
                  TextButton(
                    onPressed: _cursores.isEmpty
                        ? null
                        : () => setState(() => _cursores.removeLast()),
                    child: const Text('Anterior'),
                  ),
                  TextButton(
                    onPressed: docs.length < 25
                        ? null
                        : () => setState(() => _cursores.add(docs.last)),
                    child: const Text('Siguiente'),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class ResumenGps extends StatelessWidget {
  const ResumenGps({super.key, required this.datos});
  final Map<String, dynamic>? datos;
  @override
  Widget build(BuildContext context) {
    if (datos == null) return const Text('Sin muestras GPS guardadas.');
    String fecha(dynamic t) => t is num
        ? DateTime.fromMillisecondsSinceEpoch(t.toInt()).toLocal().toString()
        : 'Sin fecha';
    return Text(
      'GPS observado: ${datos!['conteo'] ?? 0} muestras.\nDesde ${fecha(datos!['primerTs'])} hasta ${fecha(datos!['ultimoTs'])}.',
    );
  }
}

/// Ficha del viaje archivado. Usa los datos de la página ya autorizada.
Future<void> mostrarDetalleHistorial(
  BuildContext context,
  Map<String, dynamic> datos,
) {
  final historial = datos['historial'];
  final origen = datos['origen'];
  final destino = datos['destino'];
  final necesidades = datos['necesidades'];
  const cierres = {
    'finalizado': 'Finalizado',
    'cancelado': 'Cancelado',
    'reasignado': 'Reasignado a otro chofer',
    'cuenta_eliminada': 'Cuenta eliminada',
  };
  const estados = {
    'solicitado': 'Solicitado',
    'asignado': 'Asignado',
    'conductor_en_camino': 'Chofer en camino',
    'conductor_llego': 'Chofer llegó',
    'en_viaje': 'En viaje',
    'finalizado': 'Finalizado',
    'cancelado': 'Cancelado',
  };
  final cierre = datos['cierre'] ?? datos['estadoFinal'];
  final entradas = historial is List ? historial.whereType<Map>().toList() : [];
  return showModalBottomSheet<void>(
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
            datos['pacienteNombre']?.toString() ?? 'Paciente',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          Text('Chofer: ${datos['conductorNombre'] ?? 'Sin nombre archivado'}'),
          Text('Resultado: ${cierres[cierre] ?? cierre ?? 'Sin resultado'}'),
          if (datos['fecha'] != null)
            Text('Fecha del viaje: ${datos['fecha']} ${datos['hora'] ?? ''}'),
          Text('Archivado: ${datos['archivadoEn'] ?? 'Sin fecha'}'),
          if (origen is Map && origen['direccion'] != null)
            Text('Retiro: ${origen['direccion']}'),
          if (destino is Map && destino['direccion'] != null)
            Text('Destino: ${destino['direccion']}'),
          if (necesidades is Map && necesidades['sillaRuedas'] == true)
            const Text('Necesita ayuda de movilidad'),
          if (datos['notas'] != null) Text('Notas: ${datos['notas']}'),
          const SizedBox(height: 16),
          Text(
            'Recorrido de estados',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (entradas.isEmpty)
            const Text('Sin cambios de estado registrados.'),
          for (final entrada in entradas)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.circle, size: 12),
              title: Text(
                entrada['estado'].toString().startsWith('rechazado:')
                    ? 'Chofer devolvió la solicitud'
                    : estados[entrada['estado']] ??
                          entrada['estado']?.toString() ??
                          'Sin estado',
              ),
              subtitle: Text(entrada['fecha']?.toString() ?? 'Sin fecha'),
            ),
        ],
      ),
    ),
  );
}
