/* ASORC · configuración de sincronización.
 *
 * Estos dos valores son PÚBLICOS por diseño y por eso están versionados: viajan
 * dentro del JavaScript que descarga cualquier visitante del sitio.
 *
 * No hay cuentas ni autenticación: la web entra con el rol anon y todos los
 * navegadores comparten UN progreso, el del perfil 'default'. Quien descubra
 * la URL puede leerlo y cambiarlo, y eso está asumido a conciencia: lo que se
 * guarda es «he acertado 67 de 380 preguntas de LPIC-2».
 *
 * Lo que sí acota el daño son las políticas de supabase/schema.sql: el
 * histórico es de solo añadir, ninguna tabla concede DELETE y todo está atado
 * al perfil fijo. Sin ellas esto no se sostiene.
 *
 * NUNCA sustituyas esto por una sb_secret_..., una service_role o la contraseña
 * de la base de datos: eso sí sería un secreto, saltaría RLS y quedaría a la
 * vista de todos. cloud.js rechaza esas claves si las detecta.
 */
window.ASORC_CONFIG = {
  supabaseUrl: 'https://lfnexutobezuqmxvcxtm.supabase.co',
  supabaseAnonKey: 'sb_publishable_gwGDzL-5BQ_Mm7CX6kaaEw_8ARfzUwW',
};
