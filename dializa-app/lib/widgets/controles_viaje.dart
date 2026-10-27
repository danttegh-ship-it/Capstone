import 'package:flutter/material.dart';

/// Acciones permitidas por el mismo contrato del servidor.
class ControlesViaje extends StatelessWidget {
  const ControlesViaje({
    super.key,
    required this.estado,
    required this.enviando,
    required this.onAvanzar,
    required this.onCancelar,
  });
  final String estado;
  final bool enviando;
  final void Function(String) onAvanzar;
  final VoidCallback onCancelar;
  @override
  Widget build(BuildContext context) {
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
              onPressed: enviando ? null : () => onAvanzar(siguiente),
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
            onPressed: enviando ? null : onCancelar,
            style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Cancelar'),
          ),
        ],
      ],
    );
  }
}
