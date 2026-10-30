import 'dart:async';
import 'package:flutter/material.dart';

/// Acciones permitidas por el mismo contrato del servidor.
class ControlesViaje extends StatefulWidget {
  const ControlesViaje({
    super.key,
    required this.estado,
    required this.enviando,
    required this.onAvanzar,
    required this.onCancelar,
  });
  final String estado;
  final bool enviando;
  final FutureOr<void> Function(String) onAvanzar;
  final FutureOr<void> Function() onCancelar;
  @override
  State<ControlesViaje> createState() => _ControlesViajeState();
}

class _ControlesViajeState extends State<ControlesViaje> {
  bool _local = false;
  Future<void> _accion(FutureOr<void> Function() accion) async {
    if (_local || widget.enviando) return;
    setState(() => _local = true);
    try {
      await accion();
    } finally {
      if (mounted) setState(() => _local = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final estado = widget.estado;
    final enviando = widget.enviando || _local;
    const siguientes = {
      'asignado': 'conductor_en_camino',
      'conductor_en_camino': 'conductor_llego',
      'conductor_llego': 'en_viaje',
      'en_viaje': 'finalizado',
    };
    const etiquetas = {
      'asignado': 'Voy en camino',
      'conductor_en_camino': 'Llegue',
      'conductor_llego': 'Iniciar viaje',
      'en_viaje': 'Finalizar viaje',
    };
    if (estado == 'finalizado' || estado == 'cancelado') {
      return Text(
        estado == 'finalizado' ? 'Viaje finalizado.' : 'Viaje cancelado.',
      );
    }
    final siguiente = siguientes[estado];
    return Row(
      children: [
        if (siguiente != null)
          Expanded(
            child: ElevatedButton(
              onPressed: enviando
                  ? null
                  : () => _accion(() => widget.onAvanzar(siguiente)),
              child: Text(etiquetas[estado]!),
            ),
          ),
        if (const [
          'asignado',
          'conductor_en_camino',
          'conductor_llego',
        ].contains(estado)) ...[
          const SizedBox(width: 8),
          OutlinedButton(
            onPressed: enviando ? null : () => _accion(widget.onCancelar),
            style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Cancelar'),
          ),
        ],
      ],
    );
  }
}
