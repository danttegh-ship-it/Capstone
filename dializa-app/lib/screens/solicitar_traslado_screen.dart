import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import '../services/geoapify_service.dart';
import '../services/errores_viaje.dart';
import '../services/ubicacion_actual.dart';

class SolicitarTrasladoScreen extends StatefulWidget {
  const SolicitarTrasladoScreen({super.key, this.crear, this.elegir});
  final Future<String> Function(Map<String, dynamic>)? crear;
  final Future<PuntoMapa?> Function(String)? elegir;
  @override
  State<SolicitarTrasladoScreen> createState() => _SolicitarTrasladoState();
}

class _SolicitarTrasladoState extends State<SolicitarTrasladoScreen> {
  final _form = GlobalKey<FormState>();
  final _origen = TextEditingController(), _destino = TextEditingController();
  final _notas = TextEditingController();
  PuntoMapa? _puntoOrigen, _puntoDestino;
  bool _silla = false,
      _acompanante = false,
      _enviando = false,
      _eligiendo = false;
  String? _mensaje;
  @override
  void dispose() {
    _origen.dispose();
    _destino.dispose();
    _notas.dispose();
    super.dispose();
  }

  Future<void> _elegir(bool origen) async {
    if (_eligiendo || _enviando) return;
    setState(() => _eligiendo = true);
    try {
      final titulo = origen ? 'Origen' : 'Destino';
      final punto = widget.elegir != null
          ? await widget.elegir!(titulo)
          : await Navigator.of(context).push<PuntoMapa>(
              MaterialPageRoute(
                builder: (_) => ElegirPuntoScreen(titulo: titulo),
              ),
            );
      if (punto != null && mounted) {
        setState(() {
          if (origen) {
            _puntoOrigen = punto;
          } else {
            _puntoDestino = punto;
          }
        });
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _mensaje = 'No se pudo seleccionar el punto. Intenta de nuevo.',
        );
      }
    } finally {
      if (mounted) setState(() => _eligiendo = false);
    }
  }

  Future<void> _usarGps() async {
    if (_eligiendo || _enviando) return;
    setState(() => _eligiendo = true);
    try {
      final ubicacion = await obtenerUbicacionActual();
      if (!mounted) return;
      setState(() {
        if (ubicacion is UbicacionExito) {
          _puntoOrigen = PuntoMapa(ubicacion.lat, ubicacion.lng);
        } else {
          _mensaje =
              'No se pudo obtener tu ubicacion. Elige el origen en el mapa.';
        }
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _mensaje =
              'No se pudo obtener tu ubicacion. Elige el origen en el mapa.',
        );
      }
    } finally {
      if (mounted) setState(() => _eligiendo = false);
    }
  }

  Future<void> _enviar() async {
    if (_enviando || _eligiendo) return;
    if (!_form.currentState!.validate()) return;
    if (_puntoOrigen == null || _puntoDestino == null) {
      setState(() => _mensaje = 'Elige el origen y el destino en el mapa.');
      return;
    }
    setState(() {
      _enviando = true;
      _mensaje = null;
    });
    try {
      final datos = <String, dynamic>{
        'origen': {
          'lat': _puntoOrigen!.lat,
          'lng': _puntoOrigen!.lng,
          'direccion': _origen.text.trim(),
        },
        'destino': {
          'lat': _puntoDestino!.lat,
          'lng': _puntoDestino!.lng,
          'direccion': _destino.text.trim(),
        },
        'necesidades': {'sillaRuedas': _silla, 'acompanante': _acompanante},
        'notas': _notas.text.trim(),
      };
      if (widget.crear != null) {
        await widget.crear!(datos);
      } else {
        await FirebaseFunctions.instanceFor(region: 'southamerica-east1')
            .httpsCallable('crearSolicitudViaje')
            .call<Map<String, dynamic>>(datos);
      }
      if (mounted) {
        setState(
          () => _mensaje =
              'Solicitud enviada. Puedes consultar su ubicacion desde tu panel.',
        );
      }
    } catch (error) {
      if (mounted) setState(() => _mensaje = mensajeErrorViaje(error));
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Solicitar traslado')),
    body: Form(
      key: _form,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Indica las direcciones y confirma sus puntos en el mapa.',
            ),
            TextFormField(
              key: const Key('origen'),
              controller: _origen,
              maxLength: 200,
              decoration: const InputDecoration(
                labelText: 'Direccion de origen',
              ),
              validator: (v) => v!.trim().isEmpty ? 'Escribe el origen' : null,
            ),
            OutlinedButton(
              onPressed: _enviando || _eligiendo ? null : () => _elegir(true),
              child: Text(
                _puntoOrigen == null
                    ? 'Elegir origen en mapa'
                    : 'Origen seleccionado',
              ),
            ),
            TextButton(
              onPressed: _enviando || _eligiendo ? null : _usarGps,
              child: const Text('Usar mi ubicacion como origen'),
            ),
            TextFormField(
              key: const Key('destino'),
              controller: _destino,
              maxLength: 200,
              decoration: const InputDecoration(
                labelText: 'Direccion de destino',
              ),
              validator: (v) => v!.trim().isEmpty ? 'Escribe el destino' : null,
            ),
            OutlinedButton(
              onPressed: _enviando || _eligiendo ? null : () => _elegir(false),
              child: Text(
                _puntoDestino == null
                    ? 'Elegir destino en mapa'
                    : 'Destino seleccionado',
              ),
            ),
            CheckboxListTile(
              title: const Text('Necesito silla de ruedas'),
              value: _silla,
              onChanged: _enviando ? null : (v) => setState(() => _silla = v!),
            ),
            CheckboxListTile(
              title: const Text('Voy con acompanante'),
              value: _acompanante,
              onChanged: _enviando
                  ? null
                  : (v) => setState(() => _acompanante = v!),
            ),
            TextFormField(
              controller: _notas,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'Indicaciones para el traslado (opcional)',
              ),
            ),
            if (_mensaje != null) Text(_mensaje!, semanticsLabel: _mensaje),
            ElevatedButton(
              onPressed: _enviando || _eligiendo ? null : _enviar,
              child: Text(_enviando ? 'Enviando...' : 'Solicitar traslado'),
            ),
          ],
        ),
      ),
    ),
  );
}

class ElegirPuntoScreen extends StatefulWidget {
  const ElegirPuntoScreen({super.key, required this.titulo});
  final String titulo;
  @override
  State<ElegirPuntoScreen> createState() => _ElegirPuntoState();
}

class _ElegirPuntoState extends State<ElegirPuntoScreen> {
  LatLng? _punto;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('${widget.titulo}: toca el mapa')),
    body: Column(
      children: [
        const Padding(
          padding: EdgeInsets.all(12),
          child: Text(
            'Mueve el mapa y toca el punto exacto. No se selecciona una direccion automaticamente.',
          ),
        ),
        Expanded(
          child: FlutterMap(
            options: MapOptions(
              initialCenter: const LatLng(-33.45, -70.66),
              initialZoom: 12,
              onTap: (_, p) => setState(() => _punto = p),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.example.dializa_app',
              ),
              if (_punto != null)
                MarkerLayer(
                  markers: [
                    Marker(
                      point: _punto!,
                      child: const Icon(
                        Icons.location_on,
                        size: 36,
                        color: Colors.purple,
                      ),
                    ),
                  ],
                ),
              const RichAttributionWidget(
                attributions: [
                  TextSourceAttribution('OpenStreetMap contributors'),
                ],
              ),
            ],
          ),
        ),
        SafeArea(
          child: ElevatedButton(
            onPressed: _punto == null
                ? null
                : () => Navigator.pop(
                    context,
                    PuntoMapa(_punto!.latitude, _punto!.longitude),
                  ),
            child: const Text('Confirmar punto'),
          ),
        ),
      ],
    ),
  );
}
