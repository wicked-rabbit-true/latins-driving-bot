export const KUMAGAYA_TEMPLATE = [
  {
    id: 'kumagaya_msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita para la *admisión a nuestra escuela en Kumagaya* ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n` +
      `🕗 *${vars.time}* (hora exacta — no llegues tarde)\n\n` +
      `📍 *Estación Kumagaya — Salida Sur*\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Zairyu Card\n` +
      `• Juminhyo\n` +
      `• Certificado de aprobación de 50 preguntas\n` +
      `• Tarjeta Suica\n` +
      `• Último pago\n\n` +
      `⚠️ *Si llegas tarde, perderás tu cita. Por favor llega puntual.*`,
  },
  {
    id: 'kumagaya_map',
    type: 'text',
    skipTranslation: true,
    content: () => 'https://maps.app.goo.gl/d2edCSUut5xDfaAM6',
  },
];

export const CHIBA100_TEMPLATE = [
  {
    id: 'chiba100_msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita para el *examen de 100 preguntas* ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n` +
      `🕗 *${vars.time}* (hora exacta — no llegues tarde)\n\n` +
      `📍 *CENTRO DE LICENCIAS MAKUHARI — Planta Baja*\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Zairyu Card\n` +
      `• Juminhyo\n` +
      `• Karimenkyo (licencia provisional)\n` +
      `• Certificado de la escuela\n` +
      `• 2 fotos (3 cm × 2,4 cm)\n` +
      `• ¥5.000\n\n` +
      `⚠️ *Si llegas tarde, perderás tu cita. Por favor llega puntual.*`,
  },
  {
    id: 'chiba100_map',
    type: 'text',
    skipTranslation: true,
    content: () => 'https://maps.app.goo.gl/N2on2wWJrvCGobn9A',
  },
];

export const KONOSU100_TEMPLATE = [
  {
    id: 'konosu100_msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita para el *examen de 100 preguntas* ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n` +
      `🕗 *${vars.time}* (hora exacta — no llegues tarde)\n\n` +
      `📍 *Nuestra oficina en Konosu, Saitama*\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Zairyu Card\n` +
      `• Juminhyo\n` +
      `• Karimenkyo (licencia provisional)\n` +
      `• Certificado de la escuela\n` +
      `• 2 fotos (3 cm × 2,4 cm)\n` +
      `• Tarjeta Suica (con ¥5.000 cargados)\n\n` +
      `⚠️ *Si llegas tarde, perderás tu cita. Por favor llega puntual.*`,
  },
  {
    id: 'konosu100_map',
    type: 'text',
    skipTranslation: true,
    content: () => 'https://maps.app.goo.gl/3v72dhC1nPPBHqT17',
  },
];

export const TOCHIGI100_TEMPLATE = [
  {
    id: 'tochigi100_msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita para el *examen de 100 preguntas* ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n` +
      `🕣 *${vars.time}* (hora exacta — no llegues tarde)\n\n` +
      `📍 *CENTRO DE LICENCIAS KANUMA — 2do Piso*\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Zairyu Card\n` +
      `• Juminhyo\n` +
      `• Karimenkyo (licencia provisional)\n` +
      `• Certificado de la escuela\n` +
      `• 2 fotos (3 cm × 2,4 cm)\n` +
      `• ¥5.000\n\n` +
      `⚠️ *Si llegas tarde, perderás tu cita. Por favor llega puntual.*`,
  },
  {
    id: 'tochigi100_map',
    type: 'text',
    skipTranslation: true,
    content: () => 'https://maps.app.goo.gl/PE2mWZkJiXr57Yj49',
  },
];

export const TOCHIGI_TEMPLATE = [
  {
    id: 'tochigi_msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita para el *examen de 50 preguntas* ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n` +
      `🕗 *${vars.time}* (hora exacta — no llegues tarde)\n\n` +
      `📍 *CENTRO DE LICENCIAS KANUMA — Área de Estacionamiento*\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Zairyu Card\n` +
      `• Juminhyo — solo si aún NO nos la has entregado\n` +
      `• 2 fotos (3 cm × 2,4 cm)\n` +
      `• ¥2.950\n\n` +
      `⚠️ *Si llegas tarde, perderás tu cita. Por favor llega puntual.*`,
  },
  {
    id: 'tochigi_map',
    type: 'text',
    skipTranslation: true,
    content: () => 'https://maps.app.goo.gl/PE2mWZkJiXr57Yj49',
  },
];

export const KONOSU_TEMPLATE = [
  {
    id: 'konosu_msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita para el *examen de 50 preguntas* ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n` +
      `🕕 *${vars.time}* (hora exacta — no llegues tarde)\n\n` +
      `📍 *Estación Konosu — Salida Este*\n` +
      `Frente a la tienda *docomo*\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Zairyu Card\n` +
      `• Juminhyo — solo si aún NO nos la has entregado\n` +
      `• 2 fotos (3 cm × 2,4 cm)\n` +
      `• ¥2.950\n\n` +
      `⚠️ *Si llegas tarde, perderás tu cita. Por favor llega puntual.*`,
  },
  {
    id: 'konosu_img',
    type: 'image',
    skipTranslation: true,
    imagePath: 'konosu_docomo.jpg',
    content: () => '',
  },
];

export const CONFIRMATION_TEMPLATE = [
  {
    id: 'msg1',
    type: 'text',
    skipTranslation: false,
    content: (vars) =>
      `¡Tu cita en la escuela ha sido confirmada! ✅\n\n` +
      `📅 *${vars.date}*\n\n` +
      `📍 Punto de recogida: *Estación Tsuruoka*\n\n` +
      `🕐 *${vars.time}* — El autobús pasará a recogerte en la Estación Tsuruoka. ` +
      `Por favor no llegues tarde, de lo contrario el curso será cancelado. 🙏\n\n` +
      `📋 *Por favor trae:*\n\n` +
      `• Gafas (si las usas)\n` +
      `• Zairyu Card\n` +
      `• Documento del Centro de Licencias (Menkyo Center)\n` +
      `• Juminhyo (certificado de domicilio)\n` +
      `• Sello personal (Hanko)\n` +
      `• Tarjeta de seguro médico (Hokenshou)\n` +
      `• Dinero (Karimenkyo: ¥2.950 + dinero para comida)\n\n` +
      `🏠 *Incluido:*\n` +
      `• Almuerzo\n` +
      `• Habitación compartida con cocina\n` +
      `• Cuaderno y lápiz\n` +
      `• Sandalias japonesas\n\n` +
      `⚠️ Tu destino final es *Estación Tsuruoka*. El instructor te estará esperando hasta la 1:00 PM.`,
  },
  {
    id: 'msg2_map',
    type: 'text',
    skipTranslation: true,
    content: () => 'https://goo.gl/maps/bPBSunXGEFucK91s7',
  },
  {
    id: 'msg3_wait_text',
    type: 'text',
    skipTranslation: false,
    content: () =>
      `📍 Cuando llegues a la Estación Tsuruoka, espera en este lugar — ` +
      `el instructor vendrá a recogerte ahí.`,
  },
  {
    id: 'msg3_wait_img1',
    type: 'image',
    skipTranslation: true,
    imagePath: 'tsuruoka_wait_1.png',
    content: () => '',
  },
  {
    id: 'msg3_wait_img2',
    type: 'image',
    skipTranslation: true,
    imagePath: 'tsuruoka_wait_2.png',
    content: () => '',
  },
  {
    id: 'msg5_bus_text',
    type: 'text',
    skipTranslation: false,
    content: () =>
      `🚌 Exactamente a la *1:00 PM* el autobús vendrá a recogerte.\n\n` +
      `⏰ Por favor no llegues tarde — ¡esto es muy importante!`,
  },
  {
    id: 'msg5_bus_img',
    type: 'image',
    skipTranslation: true,
    imagePath: 'bus.png',
    content: () => '',
  },
  {
    id: 'msg6_rules',
    type: 'text',
    skipTranslation: false,
    content: () =>
      `📌 Durante tu estancia en la escuela, por favor sigue estas normas:\n\n` +
      `1. No llegues tarde a las clases de conducción ni a las clases teóricas.\n` +
      `2. El alcohol está estrictamente prohibido.\n` +
      `3. Solo se puede fumar en las áreas designadas.\n` +
      `4. No salgas de la escuela sin permiso ni después de las 10:00 PM.\n` +
      `5. No escribas en las paredes ni dañes el material de la escuela.\n\n` +
      `⚠️ El incumplimiento de estas normas puede resultar en la cancelación de tu curso. Por favor presta atención.`,
  },
];
