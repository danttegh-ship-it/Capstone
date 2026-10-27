import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

/// Panel de administrador para gestionar conductores (puntos 9.4, 13.11
/// del requerimiento): aprobar choferes que se registraron con sus datos
/// de vehículo, y activar/desactivar sus cuentas. Pantalla nueva -- no
/// modifica nada de admin_home.dart salvo el botón para llegar aquí.
class AdminConductoresScreen extends StatelessWidget {
  const AdminConductoresScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Gestionar conductores')),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: FirebaseFirestore.instance
            .collection('usuarios')
            .where('rol', isEqualTo: 'chofer')
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error al cargar: ${snapshot.error}'));
          }

          final choferes = snapshot.data?.docs ?? [];

          if (choferes.isEmpty) {
            return const Center(
              child: Text(
                'Todavía no hay choferes registrados.\nEl registro lo hace cada chofer desde su propia cuenta.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16),
              ),
            );
          }

          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: choferes.length,
            itemBuilder: (context, index) {
              final doc = choferes[index];
              return _TarjetaConductor(uid: doc.id, datos: doc.data());
            },
          );
        },
      ),
    );
  }
}

class _TarjetaConductor extends StatefulWidget {
  const _TarjetaConductor({required this.uid, required this.datos});

  final String uid;
  final Map<String, dynamic> datos;

  @override
  State<_TarjetaConductor> createState() => _TarjetaConductorState();
}

class _TarjetaConductorState extends State<_TarjetaConductor> {
  final _functions = FirebaseFunctions.instanceFor(
    region: 'southamerica-east1',
  );
  bool _procesando = false;
  String? _error;

  Future<void> _aprobar() async {
    setState(() {
      _procesando = true;
      _error = null;
    });
    try {
      await _functions
          .httpsCallable('aprobarConductor')
          .call<Map<String, dynamic>>({'uid': widget.uid});
    } catch (e) {
      setState(() => _error = 'No se pudo aprobar: $e');
    } finally {
      if (mounted) setState(() => _procesando = false);
    }
  }

  Future<void> _cambiarActivo(bool activo) async {
    setState(() {
      _procesando = true;
      _error = null;
    });
    try {
      await _functions
          .httpsCallable('activarDesactivarCuenta')
          .call<Map<String, dynamic>>({'uid': widget.uid, 'activo': activo});
    } catch (e) {
      setState(() => _error = 'No se pudo actualizar: $e');
    } finally {
      if (mounted) setState(() => _procesando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final nombre = (widget.datos['nombre'] as String?) ?? '(sin nombre)';
    final aprobado = widget.datos['aprobado'] as bool? ?? false;
    final activo = widget.datos['activo'] as bool? ?? false;
    final operacion = widget.datos['operacionCuenta'] as Map<String, dynamic>?;
    final pendiente = operacion != null;
    final reintentar = operacion?['estado'] == 'reintentar';
    final accionActivo = pendiente ? operacion['accion'] == 'activar' : !activo;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    nombre,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (!aprobado)
                  const Chip(
                    label: Text('Pendiente de aprobación'),
                    backgroundColor: Color(0xFFFFF3CD),
                  )
                else if (!activo)
                  const Chip(
                    label: Text('Desactivado'),
                    backgroundColor: Color(0xFFFFE0E0),
                  )
                else
                  const Chip(
                    label: Text('Activo'),
                    backgroundColor: Color(0xFFE0F5E0),
                  ),
              ],
            ),
            _buildDatosVehiculo(),
            const SizedBox(height: 10),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            Row(
              children: [
                if (!aprobado && !pendiente)
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: _procesando ? null : _aprobar,
                      icon: const Icon(Icons.check_circle_outline),
                      label: const Text('Aprobar'),
                    ),
                  )
                else
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _procesando ||
                              (pendiente &&
                                  (!reintentar ||
                                      operacion['accion'] == 'eliminar'))
                          ? null
                          : () => _cambiarActivo(accionActivo),
                      icon: Icon(activo ? Icons.block : Icons.restart_alt),
                      label: Text(
                        pendiente
                            ? (reintentar
                                  ? 'Reintentar operación'
                                  : 'Operación en curso')
                            : (activo ? 'Desactivar' : 'Reactivar'),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDatosVehiculo() {
    return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      future: FirebaseFirestore.instance
          .collection('choferes_privado')
          .doc(widget.uid)
          .get(),
      builder: (context, snapshot) {
        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const Padding(
            padding: EdgeInsets.only(top: 4),
            child: Text(
              'Aún no completó sus datos de vehículo.',
              style: TextStyle(color: Colors.grey),
            ),
          );
        }
        final datos = snapshot.data!.data()!;
        final patente = datos['patente'] as String? ?? '-';
        final modelo = datos['modeloVehiculo'] as String? ?? '-';
        final adaptado = datos['vehiculoAdaptado'] as bool? ?? false;

        return Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Patente: $patente · Vehículo: $modelo'),
              if (adaptado)
                const Text(
                  'Vehículo adaptado para movilidad reducida',
                  style: TextStyle(color: Colors.blue),
                ),
            ],
          ),
        );
      },
    );
  }
}
