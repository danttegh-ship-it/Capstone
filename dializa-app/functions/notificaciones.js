// Notificaciones push (FCM), puerto de
// daily-app/android/.../DailyAppMessagingService.kt + la logica server-side
// que dispara el push cuando a un paciente se le asigna chofer (puntos
// 14.1, 14.3). En vez de requerir que el cliente llame a una funcion
// explicitamente, se dispara solo via un trigger de Firestore -- asi
// funciona tanto si el admin asigna desde `viajes` como si un chofer
// acepta una `solicitud`.
//
// El deep link (punto 14.4) se simplifica respecto a daily-app: dializa-app
// todavia no tiene una pantalla de detalle de viaje por id, asi que el dato
// `solicitudId`/`pacienteId` viaja en el `data` payload para cuando esa
// pantalla exista; por ahora el tap solo abre la app en su pantalla de rol
// (comportamiento por defecto de FCM sin una Activity/ruta especifica).

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getMessaging } = require("firebase-admin/messaging");

function init(db) {
  async function enviarNotificacion(uidDestino, titulo, cuerpo, datos = {}) {
    const usuarioDoc = await db.collection("usuarios").doc(uidDestino).get();
    const token = usuarioDoc.exists ? usuarioDoc.data().fcmToken : null;
    if (!token) return; // el usuario no tiene token registrado todavia

    await getMessaging()
      .send({
        token,
        notification: { title: titulo, body: cuerpo },
        data: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])),
      })
      .catch((error) => {
        // Un token invalido/expirado no debe tumbar la funcion que lo
        // disparo; solo se registra el error.
        console.error("Error enviando notificacion FCM:", error);
      });
  }

  // Notifica al paciente cuando `viajes/{pacienteId}` pasa a tener chofer.
  const notificarAsignacionViaje = onDocumentWritten("viajes/{pacienteId}", async (event) => {
    const antes = event.data.before.exists ? event.data.before.data() : null;
    const despues = event.data.after.exists ? event.data.after.data() : null;
    if (!despues) return;

    const choferAsignadoAhora =
      despues.choferId && (!antes || antes.choferId !== despues.choferId || antes.viajeId !== despues.viajeId);
    if (!choferAsignadoAhora) return;

    const pacienteId = event.params.pacienteId;
    await enviarNotificacion(
      pacienteId,
      "Chofer asignado",
      `${despues.choferNombre || "Un chofer"} te llevara el ${despues.fecha} a las ${despues.hora}.`,
      { tipo: "viaje", pacienteId }
    );
  });

  // Notifica al paciente cuando un chofer acepta su `solicitudes/{id}`.
  const notificarAsignacionSolicitud = onDocumentWritten("solicitudes/{solicitudId}", async (event) => {
    const antes = event.data.before.exists ? event.data.before.data() : null;
    const despues = event.data.after.exists ? event.data.after.data() : null;
    if (!despues) return;

    const recienAsignada = despues.estado === "asignado" && (!antes || antes.estado !== "asignado");
    if (!recienAsignada) return;

    await enviarNotificacion(
      despues.pacienteId,
      "Viaje confirmado",
      "Un chofer aceptó tu solicitud de traslado.",
      { tipo: "solicitud", solicitudId: event.params.solicitudId }
    );
  });

  return { notificarAsignacionViaje, notificarAsignacionSolicitud };
}

module.exports = { init };
