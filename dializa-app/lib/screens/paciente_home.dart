import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'login_screen.dart';
import '../services/auth_service.dart';
import '../services/geoapify_service.dart';
import '../config/feature_flags.dart';

/// Pantalla principal del paciente.
///
/// Permite al paciente indicar:
/// 1. Si asistirá a su sesión de diálisis.
/// 2. Si asiste, cómo llegará (por sus medios o necesita que lo busquen).
/// 3. Si necesita ayuda de movilidad para subir al vehículo.
///
/// La respuesta se guarda en Firestore, en la colección
/// `respuestas_paciente`, usando el UID del usuario como ID del documento.
/// Al abrir la pantalla, se carga la última respuesta guardada (si existe)
/// para que el paciente pueda revisarla y modificarla.
class PacienteHome extends StatefulWidget {
  const PacienteHome({super.key});

  @override
  State<PacienteHome> createState() => _PacienteHomeState();
}

class _PacienteHomeState extends State<PacienteHome> {
  // ---------------------------------------------------------------------
  // Estado del formulario
  // ---------------------------------------------------------------------

  bool? _asistira;
  String? _comoLlega; // 'propios_medios' o 'necesita_busqueda'
  bool _necesitaMovilidad = false;

  bool _cargandoDatos = true; // mientras se busca la respuesta previa
  bool _guardando = false;
  String? _mensaje;

  // ---------------------------------------------------------------------
  // Direccion de retiro (solo si _comoLlega == 'necesita_busqueda').
  //
  // Punto 6.9 del requerimiento: Geoapify queda integrado pero
  // desactivado hasta nuevo aviso. Mientras
  // `FeatureFlags.geoapifyHabilitado` sea `false`, esta pantalla NO llama
  // a la Cloud Function `geocodificarDireccion` (que de todas formas
  // devolveria un error `failed-precondition` mientras el flag del
  // backend tambien este apagado) -- en su lugar usa un campo de texto
  // simple que guarda la direccion tal cual la escribe el paciente, sin
  // coordenadas. Cuando se active el flag, vuelve a aparecer el buscador
  // con autocompletado y coordenadas.
  // ---------------------------------------------------------------------
  final _geoapifyService = GeoapifyService();
  final _direccionController = TextEditingController();
  List<DireccionEncontrada> _sugerenciasDireccion = [];
  DireccionEncontrada? _direccionSeleccionada;
  bool _buscandoDireccion = false;
  String? _errorDireccion;

  /// Texto libre de direccion, usado solo cuando
  /// `FeatureFlags.geoapifyHabilitado` es `false`.
  final _direccionTextoLibreController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _cargarRespuestaExistente();
  }

  // ---------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------

  /// Busca en Firestore si el paciente ya había guardado una respuesta
  /// antes, y si existe, la muestra en el formulario para que pueda
  /// revisarla o modificarla.
  Future<void> _cargarRespuestaExistente() async {
    final uid = FirebaseAuth.instance.currentUser!.uid;

    final doc = await FirebaseFirestore.instance
        .collection('respuestas_paciente')
        .doc(uid)
        .get();

    if (doc.exists) {
      final datos = doc.data()!;
      final direccion = datos['direccion'] as Map<String, dynamic>?;
      final direccionTexto = datos['direccionTexto'] as String?;
      setState(() {
        _asistira = datos['asistira'] as bool?;
        _comoLlega = datos['comoLlega'] as String?;
        _necesitaMovilidad = datos['necesitaMovilidad'] as bool? ?? false;
        if (direccion != null) {
          _direccionSeleccionada = DireccionEncontrada(
            etiqueta: direccion['etiqueta'] as String? ?? '',
            lat: (direccion['lat'] as num).toDouble(),
            lng: (direccion['lng'] as num).toDouble(),
          );
          _direccionController.text = _direccionSeleccionada!.etiqueta;
        }
        if (direccionTexto != null) {
          _direccionTextoLibreController.text = direccionTexto;
        }
      });
    }

    setState(() => _cargandoDatos = false);
  }

  /// Busca sugerencias de direccion a partir de lo que escribe el
  /// paciente, usando la Cloud Function geocodificarDireccion.
  Future<void> _buscarDireccion() async {
    final texto = _direccionController.text.trim();
    if (texto.length < 3) {
      setState(() {
        _errorDireccion = 'Escribe al menos 3 caracteres para buscar.';
        _sugerenciasDireccion = [];
      });
      return;
    }

    setState(() {
      _buscandoDireccion = true;
      _errorDireccion = null;
    });

    try {
      final resultados = await _geoapifyService.geocodificarDireccion(texto);
      setState(() {
        _sugerenciasDireccion = resultados;
        _buscandoDireccion = false;
        if (resultados.isEmpty) {
          _errorDireccion = 'No se encontraron direcciones. Intenta ser mas especifico.';
        }
      });
    } catch (e) {
      setState(() {
        _buscandoDireccion = false;
        _errorDireccion = 'No se pudo buscar la direccion: $e';
      });
    }
  }

  void _seleccionarDireccion(DireccionEncontrada direccion) {
    setState(() {
      _direccionSeleccionada = direccion;
      _direccionController.text = direccion.etiqueta;
      _sugerenciasDireccion = [];
    });
  }

  @override
  void dispose() {
    _direccionController.dispose();
    _direccionTextoLibreController.dispose();
    super.dispose();
  }

  Future<void> _cerrarSesion() async {
    await AuthService().cerrarSesion();

    if (!mounted) return;

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  Future<void> _guardarRespuesta() async {
    if (!_formularioEsValido()) return;

    setState(() {
      _guardando = true;
      _mensaje = null;
    });

    final uid = FirebaseAuth.instance.currentUser!.uid;
    final requiereBusqueda = _asistira == true && _comoLlega == 'necesita_busqueda';

    await FirebaseFirestore.instance
        .collection('respuestas_paciente')
        .doc(uid)
        .set({
      'asistira': _asistira,
      'comoLlega': _asistira == true ? _comoLlega : null,
      'necesitaMovilidad': _necesitaMovilidad,
      'fecha': DateTime.now().toIso8601String(),
      // Con Geoapify activado se guardan coordenadas (direccion); con el
      // flag apagado se guarda solo el texto que escribio el paciente
      // (direccionTexto), sin geocodificar.
      'direccion': requiereBusqueda &&
              FeatureFlags.geoapifyHabilitado &&
              _direccionSeleccionada != null
          ? {
              'etiqueta': _direccionSeleccionada!.etiqueta,
              'lat': _direccionSeleccionada!.lat,
              'lng': _direccionSeleccionada!.lng,
            }
          : null,
      'direccionTexto': requiereBusqueda && !FeatureFlags.geoapifyHabilitado
          ? _direccionTextoLibreController.text.trim()
          : null,
    });

    setState(() {
      _guardando = false;
      _mensaje = 'Respuesta guardada correctamente.';
    });

    _mostrarConfirmacion();
  }

  /// Muestra un aviso emergente (snackbar) confirmando que se guardó,
  /// además del mensaje que ya aparece en el formulario.
  void _mostrarConfirmacion() {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          '✓ Tu respuesta fue registrada. Puedes modificarla cuando quieras.',
          style: TextStyle(fontSize: 16),
        ),
        backgroundColor: Colors.green,
        duration: Duration(seconds: 3),
      ),
    );
  }

  /// Valida el formulario antes de guardar.
  /// Devuelve `true` si todo está correcto; si no, muestra un mensaje
  /// de error y devuelve `false`.
  bool _formularioEsValido() {
    if (_asistira == null) {
      setState(() => _mensaje = 'Por favor indica si asistirás.');
      return false;
    }
    if (_asistira == true && _comoLlega == null) {
      setState(() => _mensaje = 'Por favor indica cómo llegarás.');
      return false;
    }
    if (_asistira == true && _comoLlega == 'necesita_busqueda') {
      if (FeatureFlags.geoapifyHabilitado) {
        if (_direccionSeleccionada == null) {
          setState(() => _mensaje = 'Por favor busca y selecciona tu dirección de retiro.');
          return false;
        }
      } else if (_direccionTextoLibreController.text.trim().isEmpty) {
        setState(() => _mensaje = 'Por favor escribe tu dirección de retiro.');
        return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    if (_cargandoDatos) {
      return Scaffold(
        appBar: _buildAppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: _buildAppBar(),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildAvisoRespuestaPrevia(),
            _buildPreguntaAsistencia(),
            if (_asistira == true) _buildPreguntaComoLlega(),
            _buildPreguntaMovilidad(),
            const SizedBox(height: 24),
            if (_mensaje != null) _buildMensaje(),
            _buildBotonGuardar(),
          ],
        ),
      ),
    );
  }

  AppBar _buildAppBar() {
    return AppBar(
      title: const Text('Panel de Paciente'),
      actions: [
        IconButton(
          icon: const Icon(Icons.logout),
          tooltip: 'Cerrar sesión',
          onPressed: _cerrarSesion,
        ),
      ],
    );
  }

  /// Si el paciente ya había respondido antes, muestra un pequeño aviso
  /// aclarando que puede modificar su respuesta.
  Widget _buildAvisoRespuestaPrevia() {
    if (_asistira == null) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.blue.shade200),
      ),
      child: const Row(
        children: [
          Icon(Icons.info_outline, color: Colors.blue),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'Ya tienes una respuesta guardada. Puedes modificarla y '
              'volver a guardar.',
              style: TextStyle(fontSize: 15),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPreguntaAsistencia() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _TituloPregunta('¿Asistirás a tu sesión?'),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _BotonSiNo(
                texto: 'Sí',
                seleccionado: _asistira == true,
                colorSeleccionado: Colors.green,
                onPressed: () => setState(() => _asistira = true),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _BotonSiNo(
                texto: 'No',
                seleccionado: _asistira == false,
                colorSeleccionado: Colors.red,
                onPressed: () => setState(() {
                  _asistira = false;
                  _comoLlega = null;
                }),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildPreguntaComoLlega() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 28),
        const _TituloPregunta('¿Cómo llegarás?'),
        const SizedBox(height: 12),
        RadioListTile<String>(
          title: const Text(
            'Voy por mis propios medios',
            style: TextStyle(fontSize: 18),
          ),
          value: 'propios_medios',
          groupValue: _comoLlega,
          onChanged: (v) => setState(() => _comoLlega = v),
        ),
        RadioListTile<String>(
          title: const Text(
            'Necesito que me busquen',
            style: TextStyle(fontSize: 18),
          ),
          value: 'necesita_busqueda',
          groupValue: _comoLlega,
          onChanged: (v) => setState(() => _comoLlega = v),
        ),
        if (_comoLlega == 'necesita_busqueda') _buildDireccionRetiro(),
      ],
    );
  }

  /// Seccion para buscar y confirmar la direccion donde el chofer debe
  /// retirar al paciente. Usa geocodificarDireccion (Geoapify Geocoding
  /// API via Cloud Function) para convertir el texto a coordenadas --
  /// pero solo mientras `FeatureFlags.geoapifyHabilitado` este activo
  /// (punto 6.9). Con el flag apagado se muestra un campo de texto
  /// simple en su lugar, para no llamar a una Cloud Function desactivada.
  Widget _buildDireccionRetiro() {
    if (!FeatureFlags.geoapifyHabilitado) {
      return _buildDireccionRetiroTextoSimple();
    }

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Dirección de retiro',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _direccionController,
                  decoration: const InputDecoration(
                    hintText: 'Ej: Av. Providencia 1234, Santiago',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _buscarDireccion(),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                onPressed: _buscandoDireccion ? null : _buscarDireccion,
                icon: _buscandoDireccion
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.search),
              ),
            ],
          ),
          if (_errorDireccion != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(_errorDireccion!, style: const TextStyle(color: Colors.red)),
            ),
          if (_sugerenciasDireccion.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 6),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey.shade300),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Column(
                children: _sugerenciasDireccion
                    .map(
                      (s) => ListTile(
                        dense: true,
                        leading: const Icon(Icons.location_on_outlined),
                        title: Text(s.etiqueta),
                        onTap: () => _seleccionarDireccion(s),
                      ),
                    )
                    .toList(),
              ),
            ),
          if (_direccionSeleccionada != null && _sugerenciasDireccion.isEmpty)
            Container(
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.green, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_direccionSeleccionada!.etiqueta)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// Version simple de la direccion de retiro, usada mientras Geoapify
  /// esta desactivado (`FeatureFlags.geoapifyHabilitado == false`): solo
  /// pide el texto, sin buscar coordenadas.
  Widget _buildDireccionRetiroTextoSimple() {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Dirección de retiro',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _direccionTextoLibreController,
            decoration: const InputDecoration(
              hintText: 'Ej: Av. Providencia 1234, Santiago',
              border: OutlineInputBorder(),
            ),
            style: const TextStyle(fontSize: 16),
          ),
        ],
      ),
    );
  }

  Widget _buildPreguntaMovilidad() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 28),
        const _TituloPregunta('¿Necesitas ayuda de movilidad?'),
        SwitchListTile(
          title: const Text(
            'Sí, necesito ayuda para subir al vehículo',
            style: TextStyle(fontSize: 18),
          ),
          value: _necesitaMovilidad,
          onChanged: (v) => setState(() => _necesitaMovilidad = v),
        ),
      ],
    );
  }

  Widget _buildMensaje() {
    final esExito = _mensaje!.contains('correctamente');
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Text(
        _mensaje!,
        style: TextStyle(
          color: esExito ? Colors.green : Colors.red,
          fontSize: 16,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }

  Widget _buildBotonGuardar() {
    return SizedBox(
      height: 56,
      child: ElevatedButton(
        onPressed: _guardando ? null : _guardarRespuesta,
        child: _guardando
            ? const CircularProgressIndicator(color: Colors.white)
            : const Text('Guardar respuesta', style: TextStyle(fontSize: 18)),
      ),
    );
  }
}

// =============================================================================
// Widgets auxiliares reutilizables
// =============================================================================

/// Título estándar para cada pregunta del formulario.
class _TituloPregunta extends StatelessWidget {
  final String texto;

  const _TituloPregunta(this.texto);

  @override
  Widget build(BuildContext context) {
    return Text(
      texto,
      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
    );
  }
}

/// Botón grande de Sí/No que cambia de color cuando está seleccionado.
/// Pensado para ser fácil de tocar en pantallas usadas por adultos mayores.
class _BotonSiNo extends StatelessWidget {
  final String texto;
  final bool seleccionado;
  final Color colorSeleccionado;
  final VoidCallback onPressed;

  const _BotonSiNo({
    required this.texto,
    required this.seleccionado,
    required this.colorSeleccionado,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      style: ElevatedButton.styleFrom(
        backgroundColor: seleccionado ? colorSeleccionado : null,
        padding: const EdgeInsets.symmetric(vertical: 20),
      ),
      onPressed: onPressed,
      child: Text(texto, style: const TextStyle(fontSize: 18)),
    );
  }
}