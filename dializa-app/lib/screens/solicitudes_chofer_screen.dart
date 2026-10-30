import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../widgets/controles_viaje.dart';
import '../services/seguimiento_gps.dart';
import '../services/errores_viaje.dart';

class SolicitudesChoferScreen extends StatelessWidget {
  const SolicitudesChoferScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final db = FirebaseFirestore.instance;
    final uid = FirebaseAuth.instance.currentUser!.uid;
    Widget lista(Query<Map<String, dynamic>> query, bool pendientes) =>
        StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: query.snapshots(),
          builder: (context, snap) {
            if (snap.hasError) {
              return const Text(
                'No se pudo consultar las solicitudes. Revisa tu sesion.',
              );
            }
            if (!snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final docs = snap.data!.docs
                .where(
                  (d) =>
                      !['cancelado', 'finalizado'].contains(d.data()['estado']),
                )
                .toList();
            if (docs.isEmpty) {
              return Text(
                pendientes
                    ? 'No hay solicitudes pendientes.'
                    : 'No tienes solicitudes aceptadas.',
              );
            }
            return Column(
              children: docs
                  .map(
                    (doc) => TarjetaSolicitud(
                      key: ValueKey(doc.id),
                      estado: doc.data()['estado'] as String,
                      ejecutar: (accion, nuevoEstado) async {
                        try {
                          if (nuevoEstado == 'finalizado') {
                            await SeguimientoGps.prepararCierre(doc.id);
                          }
                          await FirebaseFunctions.instanceFor(
                            region: 'southamerica-east1',
                          ).httpsCallable(accion).call<Map<String, dynamic>>({
                            'solicitudId': doc.id,
                            'coleccion': 'solicitudes',
                            'id': doc.id,
                            'viajeId': doc.id,
                            'estadoEsperado': doc.data()['estado'],
                            'nuevoEstado': ?nuevoEstado,
                          });
                        } catch (_) {
                          await SeguimientoGps.reanudarTodos().catchError(
                            (Object _) {},
                          );
                          rethrow;
                        }
                      },
                    ),
                  )
                  .toList(),
            );
          },
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Solicitudes de traslado')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Mis solicitudes aceptadas',
            style: TextStyle(fontSize: 22),
          ),
          lista(
            db.collection('solicitudes').where('conductorId', isEqualTo: uid),
            false,
          ),
          const SizedBox(height: 24),
          const Text('Pendientes', style: TextStyle(fontSize: 22)),
          // No se amplian campos ni reglas de privacidad: la tarjeta pendiente
          // no representa direcciones ni informacion del paciente.
          lista(
            db
                .collection('solicitudes')
                .where('estado', isEqualTo: 'solicitado'),
            true,
          ),
        ],
      ),
    );
  }
}

class TarjetaSolicitud extends StatefulWidget {
  const TarjetaSolicitud({
    super.key,
    required this.estado,
    required this.ejecutar,
  });
  final String estado;
  final Future<void> Function(String accion, String? nuevoEstado) ejecutar;
  @override
  State<TarjetaSolicitud> createState() => _TarjetaSolicitudState();
}

class _TarjetaSolicitudState extends State<TarjetaSolicitud> {
  bool _enviando = false;
  String? _error;
  Future<void> _accion(String nombre, [String? estado]) async {
    if (_enviando) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await widget.ejecutar(nombre, estado);
    } catch (error) {
      if (mounted) setState(() => _error = mensajeErrorViaje(error));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        children: [
          Text(
            widget.estado == 'solicitado'
                ? 'Solicitud pendiente'
                : 'Solicitud aceptada: ${widget.estado}',
          ),
          if (_error != null) Text(_error!),
          if (widget.estado == 'solicitado')
            ElevatedButton(
              onPressed: _enviando ? null : () => _accion('aceptarSolicitud'),
              child: const Text('Aceptar'),
            )
          else ...[
            ControlesViaje(
              estado: widget.estado,
              enviando: _enviando,
              onAvanzar: (s) => _accion('actualizarEstadoViaje', s),
              onCancelar: () => _accion('cancelarAsignacionConductor'),
            ),
            if (widget.estado == 'asignado')
              TextButton(
                onPressed: _enviando
                    ? null
                    : () => _accion('rechazarSolicitud'),
                child: const Text('Rechazar'),
              ),
          ],
        ],
      ),
    ),
  );
}
