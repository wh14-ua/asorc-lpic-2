/* ASORC · configuración de sincronización.
 *
 * Copia este archivo a web/config.js con los datos de tu proyecto. Sin él la
 * aplicación funciona igual: el progreso se guarda en el navegador.
 *
 * No hay cuentas ni login: hay UN progreso y lo comparten todos los navegadores
 * que abran la web. Es una decisión deliberada para una aplicación personal de
 * estudio. Quien descubra la URL puede leer o cambiar ese progreso.
 *
 * Los dos valores son PÚBLICOS por diseño: viajan dentro del JavaScript que
 * descarga cualquier visitante.
 *
 * NUNCA pongas aquí una sb_secret_ ni una service_role: saltan RLS y tendrían
 * permisos de administrador sobre toda la base de datos. cloud.js las rechaza.
 */
window.ASORC_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-CLAVE-PUBLISHABLE',
};
