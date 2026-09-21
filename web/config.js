/* ASORC · configuración de sincronización.
 *
 * Estos dos valores son PÚBLICOS por diseño y por eso están versionados: viajan
 * dentro del JavaScript que descarga cualquier visitante del sitio. No son un
 * secreto y por sí solos no dan acceso a nada.
 *
 * Quien protege los datos es Supabase Auth + las políticas RLS de
 * supabase/schema.sql: cada fila lleva user_id y solo su dueño la ve o la toca.
 *
 * NUNCA sustituyas esto por una sb_secret_..., una service_role o la contraseña
 * de la base de datos: eso sí sería un secreto y quedaría a la vista de todos.
 * cloud.js rechaza esas claves si las detecta.
 */
window.ASORC_CONFIG = {
  supabaseUrl: 'https://lfnexutobezuqmxvcxtm.supabase.co',
  supabaseAnonKey: 'sb_publishable_gwGDzL-5BQ_Mm7CX6kaaEw_8ARfzUwW',
};
