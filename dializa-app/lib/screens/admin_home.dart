import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'login_screen.dart';
import '../services/auth_service.dart';
import 'admin_conductores_screen.dart';

/// Panel del administrador.
///
/// Muestra la lista de pacientes registrados (colección `usuarios` con
/// `rol == 'paciente'`), junto con:
/// - Su última respuesta de asistencia (colección `respuestas_paciente`).
/// - Su asignación actual de chofer y hora, si existe (colección `viajes`).
///
/// Permite:
/// - Agregar / modificar / eliminar pacientes (como antes).
/// - Asignar (o reasignar) un chofer y una hora a cada paciente.
class AdminHome extends StatefulWidget {
  const AdminHome({super.key});

  @override
  State<AdminHome> createState() => _AdminHomeState();
}

class _AdminHomeState extends State<AdminHome> {
  final _firestore = FirebaseFirestore.instance;
  final _functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');

  // ---------------------------------------------------------------------
  // Acciones: sesión y pacientes
  // ---------------------------------------------------------------------

  Future<void> _cerrarSesion() async {
    await AuthService().cerrarSesion();

    if (!mounted) return;

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  // Punto 10.6: usuarios/{uid} ahora es write:false en firestore.rules,
  // asi que agregar/modificar/eliminar un paciente pasa por las Cloud
  // Functions agregarPaciente / modificarPaciente / eliminarPaciente en
  // vez de escribir Firestore directo como antes. La UI no cambia.
  Future<void> _agregarPaciente(String uid, String nombre) async {
    final callable = _functions.httpsCallable('agregarPaciente');
    await callable.call<Map<String, dynamic>>({'uid': uid, 'nombre': nombre});
  }

  Future<void> _modificarNombre(String uid, String nuevoNombre) async {
    final callable = _functions.httpsCallable('modificarPaciente');
    await callable.call<Map<String, dynamic>>({'uid': uid, 'nombre': nuevoNombre});
  }

  Future<void> _eliminarPaciente(String uid) async {
    final callable = _functions.httpsCallable('eliminarPaciente');
    await callable.call<Map<String, dynamic>>({'uid': uid});
  }

  // ---------------------------------------------------------------------
  // Acciones: asignación de viaje (chofer + hora)
  // ---------------------------------------------------------------------
  //
  // Fase 1: ya NO se escribe `viajes/{pacienteId}` directo (las reglas lo
  // prohiben). La Cloud Function `asignarViaje` valida paciente/chofer,
  // genera el id del viaje, resuelve los nombres en el servidor, ARCHIVA el
  // viaje anterior en `historial_viajes` y crea el nuevo, todo en una
  // transaccion. La UI es la misma. `choferNombre` ya no se envia: lo
  // resuelve el servidor (el parametro se conserva por compatibilidad con
  // el dialogo existente).

  Future<void> _asignarViaje({
    required String pacienteId,
    required String choferId,
    required String choferNombre,
    required DateTime fecha,
    required TimeOfDay hora,
  }) async {
    final callable = _functions.httpsCallable('asignarViaje');
    await callable.call<Map<String, dynamic>>({
      'pacienteId': pacienteId,
      'choferId': choferId,
      'fecha':
          '${fecha.year}-${fecha.month.toString().padLeft(2, '0')}-${fecha.day.toString().padLeft(2, '0')}',
      'hora':
          '${hora.hour.toString().padLeft(2, '0')}:${hora.minute.toString().padLeft(2, '0')}',
    });
  }

  // ---------------------------------------------------------------------
  // Diálogos (formularios emergentes)
  // ---------------------------------------------------------------------

  void _mostrarDialogoAgregar() {
    final uidController = TextEditingController();
    final nombreController = TextEditingController();

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Agregar paciente'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nombreController,
              decoration: const InputDecoration(labelText: 'Nombre completo'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: uidController,
              decoration: const InputDecoration(
                labelText: 'UID (de Firebase Authentication)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () async {
              final uid = uidController.text.trim();
              final nombre = nombreController.text.trim();
              if (uid.isEmpty || nombre.isEmpty) return;

              await _agregarPaciente(uid, nombre);

              if (dialogContext.mounted) Navigator.of(dialogContext).pop();
            },
            child: const Text('Agregar'),
          ),
        ],
      ),
    );
  }

  void _mostrarDialogoEditar(String uid, String nombreActual) {
    final nombreController = TextEditingController(text: nombreActual);

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Modificar paciente'),
        content: TextField(
          controller: nombreController,
          decoration: const InputDecoration(labelText: 'Nombre completo'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () async {
              final nuevoNombre = nombreController.text.trim();
              if (nuevoNombre.isEmpty) return;

              await _modificarNombre(uid, nuevoNombre);

              if (dialogContext.mounted) Navigator.of(dialogContext).pop();
            },
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
  }

  void _confirmarEliminar(String uid, String nombre) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('¿Eliminar paciente?'),
        content: Text(
          'Se eliminará a "$nombre" de la lista de la app.\n\n'
          'Esto NO elimina su cuenta de acceso; si también quieres '
          'quitarle el acceso, hazlo manualmente en Firebase Authentication.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              await _eliminarPaciente(uid);
              if (dialogContext.mounted) Navigator.of(dialogContext).pop();
            },
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
  }

  /// Diálogo para asignar (o reasignar) chofer y hora a un paciente.
  /// Carga la lista de choferes disponibles desde Firestore en vivo.
  void _mostrarDialogoAsignarViaje(String pacienteId, String nombrePaciente) {
    String? choferSeleccionadoId;
    String? choferSeleccionadoNombre;
    DateTime fechaSeleccionada = DateTime.now();
    TimeOfDay horaSeleccionada = TimeOfDay.now();

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text('Asignar viaje: $nombrePaciente'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Chofer:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  // Solo choferes aprobados por un admin (punto 9.4) y
                  // activos pueden recibir una asignación.
                  stream: _firestore
                      .collection('usuarios')
                      .where('rol', isEqualTo: 'chofer')
                      .where('aprobado', isEqualTo: true)
                      .snapshots(),
                  builder: (context, snapshot) {
                    if (!snapshot.hasData) {
                      return const CircularProgressIndicator();
                    }

                    final choferes = snapshot.data!.docs;

                    if (choferes.isEmpty) {
                      return const Text(
                        'No hay choferes aprobados todavía. Ve a "Gestionar conductores" para aprobar uno.',
                        style: TextStyle(color: Colors.red),
                      );
                    }

                    return DropdownButton<String>(
                      isExpanded: true,
                      hint: const Text('Selecciona un chofer'),
                      value: choferSeleccionadoId,
                      items: choferes.map((doc) {
                        final nombreChofer =
                            (doc.data()['nombre'] as String?) ?? '(sin nombre)';
                        return DropdownMenuItem(
                          value: doc.id,
                          child: Text(nombreChofer),
                        );
                      }).toList(),
                      onChanged: (uid) {
                        final doc = choferes.firstWhere((d) => d.id == uid);
                        setDialogState(() {
                          choferSeleccionadoId = uid;
                          choferSeleccionadoNombre =
                              (doc.data()['nombre'] as String?) ?? '(sin nombre)';
                        });
                      },
                    );
                  },
                ),
                const SizedBox(height: 20),
                const Text('Fecha:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    final elegida = await showDatePicker(
                      context: dialogContext,
                      initialDate: fechaSeleccionada,
                      firstDate: DateTime.now(),
                      lastDate: DateTime.now().add(const Duration(days: 365)),
                    );
                    if (elegida != null) {
                      setDialogState(() => fechaSeleccionada = elegida);
                    }
                  },
                  child: Text(
                    '${fechaSeleccionada.day}/${fechaSeleccionada.month}/${fechaSeleccionada.year}',
                  ),
                ),
                const SizedBox(height: 20),
                const Text('Hora:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    final elegida = await showTimePicker(
                      context: dialogContext,
                      initialTime: horaSeleccionada,
                    );
                    if (elegida != null) {
                      setDialogState(() => horaSeleccionada = elegida);
                    }
                  },
                  child: Text(horaSeleccionada.format(dialogContext)),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: choferSeleccionadoId == null
                  ? null
                  : () async {
                      try {
                        await _asignarViaje(
                          pacienteId: pacienteId,
                          choferId: choferSeleccionadoId!,
                          choferNombre: choferSeleccionadoNombre!,
                          fecha: fechaSeleccionada,
                          hora: horaSeleccionada,
                        );
                        if (dialogContext.mounted) {
                          Navigator.of(dialogContext).pop();
                        }
                      } on FirebaseFunctionsException catch (e) {
                        // El servidor puede rechazar la asignacion (chofer
                        // no aprobado, viaje en curso, datos invalidos...).
                        if (!mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              e.message ?? 'No se pudo asignar el viaje.',
                            ),
                          ),
                        );
                      }
                    },
              child: const Text('Asignar'),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Panel de Administrador'),
        actions: [
          IconButton(
            icon: const Icon(Icons.local_shipping_outlined),
            tooltip: 'Gestionar conductores',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AdminConductoresScreen()),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Cerrar sesión',
            onPressed: _cerrarSesion,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _mostrarDialogoAgregar,
        child: const Icon(Icons.add),
      ),
      body: _buildListaPacientes(),
    );
  }

  Widget _buildListaPacientes() {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _firestore
          .collection('usuarios')
          .where('rol', isEqualTo: 'paciente')
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(child: Text('Error al cargar: ${snapshot.error}'));
        }

        final documentos = snapshot.data?.docs ?? [];

        if (documentos.isEmpty) {
          return const Center(
            child: Text(
              'Aún no hay pacientes registrados.\nUsa el botón + para agregar uno.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 16),
            ),
          );
        }

        return ListView.builder(
          padding: const EdgeInsets.all(12),
          itemCount: documentos.length,
          itemBuilder: (context, index) {
            final doc = documentos[index];
            final uid = doc.id;
            final nombre = (doc.data()['nombre'] as String?) ?? '(sin nombre)';

            return _TarjetaPaciente(
              uid: uid,
              nombre: nombre,
              onEditar: () => _mostrarDialogoEditar(uid, nombre),
              onEliminar: () => _confirmarEliminar(uid, nombre),
              onAsignarViaje: () => _mostrarDialogoAsignarViaje(uid, nombre),
            );
          },
        );
      },
    );
  }
}

// =============================================================================
// Widgets auxiliares
// =============================================================================

/// Tarjeta que muestra un paciente en la lista: su nombre, última respuesta
/// de asistencia, asignación de viaje actual (si existe), y botones de
/// editar / eliminar / asignar viaje.
class _TarjetaPaciente extends StatelessWidget {
  final String uid;
  final String nombre;
  final VoidCallback onEditar;
  final VoidCallback onEliminar;
  final VoidCallback onAsignarViaje;

  const _TarjetaPaciente({
    required this.uid,
    required this.nombre,
    required this.onEditar,
    required this.onEliminar,
    required this.onAsignarViaje,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
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
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.edit, color: Colors.blue),
                  tooltip: 'Modificar',
                  onPressed: onEditar,
                ),
                IconButton(
                  icon: const Icon(Icons.delete, color: Colors.red),
                  tooltip: 'Eliminar',
                  onPressed: onEliminar,
                ),
              ],
            ),
            const SizedBox(height: 4),
            _buildEstadoAsistencia(),
            const SizedBox(height: 8),
            _buildAsignacionViaje(),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: onAsignarViaje,
                icon: const Icon(Icons.directions_car),
                label: const Text('Asignar chofer y hora'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Muestra la última respuesta de asistencia de este paciente.
  Widget _buildEstadoAsistencia() {
    return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      future: FirebaseFirestore.instance
          .collection('respuestas_paciente')
          .doc(uid)
          .get(),
      builder: (context, snapshot) {
        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const Text(
            'Aún no ha respondido',
            style: TextStyle(color: Colors.grey),
          );
        }

        final datos = snapshot.data!.data()!;
        final asistira = datos['asistira'] as bool?;
        final comoLlega = datos['comoLlega'] as String?;
        final necesitaMovilidad = datos['necesitaMovilidad'] as bool? ?? false;

        if (asistira == false) {
          return const Text(
            'No asistirá',
            style: TextStyle(color: Colors.red),
          );
        }

        final comoLlegaTexto = comoLlega == 'necesita_busqueda'
            ? 'Necesita que lo busquen'
            : 'Va por sus propios medios';

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Asiste — $comoLlegaTexto',
              style: const TextStyle(color: Colors.green),
            ),
            if (necesitaMovilidad)
              const Text(
                'Necesita ayuda de movilidad',
                style: TextStyle(color: Colors.orange),
              ),
          ],
        );
      },
    );
  }

  /// Muestra la asignación actual de chofer y hora, si existe.
  Widget _buildAsignacionViaje() {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream:
          FirebaseFirestore.instance.collection('viajes').doc(uid).snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const Text(
            'Sin chofer asignado',
            style: TextStyle(color: Colors.grey, fontStyle: FontStyle.italic),
          );
        }

        final datos = snapshot.data!.data()!;
        final choferNombre = datos['choferNombre'] as String? ?? '(sin nombre)';
        final fecha = datos['fecha'] as String? ?? '';
        final hora = datos['hora'] as String? ?? '';

        return Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.blue.shade50,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            'Chofer: $choferNombre — $fecha a las $hora',
            style: TextStyle(color: Colors.blue.shade900),
          ),
        );
      },
    );
  }
}