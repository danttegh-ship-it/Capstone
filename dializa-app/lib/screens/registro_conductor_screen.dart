import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';

/// Formulario de registro de chofer con datos de vehículo (puntos 9.4,
/// 13.12 del requerimiento), puerto de
/// daily-app/.../solicitarRegistroConductor. Lo ve cualquier chofer cuyo
/// perfil todavía no fue aprobado por un admin -- ver chofer_home.dart,
/// que decide cuándo mostrar esta pantalla.
class RegistroConductorScreen extends StatefulWidget {
  const RegistroConductorScreen({super.key, required this.yaEnviado});

  /// true si el chofer ya envió sus datos y solo está esperando
  /// aprobación; false si todavía no ha llenado el formulario.
  final bool yaEnviado;

  @override
  State<RegistroConductorScreen> createState() => _RegistroConductorScreenState();
}

class _RegistroConductorScreenState extends State<RegistroConductorScreen> {
  final _patenteController = TextEditingController();
  final _licenciaController = TextEditingController();
  final _modeloController = TextEditingController();
  final _telefonoController = TextEditingController();
  bool _vehiculoAdaptado = false;
  bool _enviando = false;
  String? _error;

  Future<void> _enviar() async {
    if (_patenteController.text.trim().isEmpty || _licenciaController.text.trim().isEmpty) {
      setState(() => _error = 'Patente y licencia son obligatorias.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      final functions = FirebaseFunctions.instanceFor(region: 'southamerica-east1');
      await functions.httpsCallable('solicitarRegistroConductor').call<Map<String, dynamic>>({
        'patente': _patenteController.text.trim(),
        'licencia': _licenciaController.text.trim(),
        'modeloVehiculo': _modeloController.text.trim(),
        'vehiculoAdaptado': _vehiculoAdaptado,
        'telefono': _telefonoController.text.trim(),
      });
      if (mounted) setState(() {});
    } catch (e) {
      setState(() => _error = 'No se pudo enviar el registro: $e');
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.yaEnviado) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              Icon(Icons.hourglass_top, size: 64, color: Colors.orange),
              SizedBox(height: 16),
              Text(
                'Tu registro está esperando aprobación de un administrador.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18),
              ),
            ],
          ),
        ),
      );
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Completa los datos de tu vehículo',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _patenteController,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Patente', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _licenciaController,
            decoration: const InputDecoration(labelText: 'N° de licencia', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _modeloController,
            decoration: const InputDecoration(labelText: 'Modelo del vehículo', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _telefonoController,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Teléfono de contacto', border: OutlineInputBorder()),
          ),
          SwitchListTile(
            title: const Text('Mi vehículo está adaptado para movilidad reducida'),
            value: _vehiculoAdaptado,
            onChanged: (v) => setState(() => _vehiculoAdaptado = v),
          ),
          const SizedBox(height: 12),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            ),
          SizedBox(
            height: 56,
            child: ElevatedButton(
              onPressed: _enviando ? null : _enviar,
              child: _enviando
                  ? const CircularProgressIndicator(color: Colors.white)
                  : const Text('Enviar para aprobación', style: TextStyle(fontSize: 18)),
            ),
          ),
        ],
      ),
    );
  }
}
