/* ASORC · configuración de sincronización (OPCIONAL).
 *
 * Copia este archivo a web/config.js y rellena los dos valores. Sin él la
 * aplicación funciona igual: el progreso se guarda en el navegador.
 *
 * Estos dos valores son PÚBLICOS por diseño: van dentro del JavaScript que
 * descarga cualquier visitante. No son un secreto y no protegen nada por sí
 * solos. Quien protege los datos es Supabase Auth + las políticas RLS de
 * supabase/schema.sql, que solo dejan a cada usuario ver y tocar sus filas.
 *
 * NUNCA pongas aquí una service_role key ni ningún secreto: tendría permisos
 * de administrador sobre toda la base de datos y estaría a la vista de todos.
 *
 * web/config.js está en .gitignore y tools/build_site.py no lo publica.
 */
window.ASORC_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-CLAVE-ANON-O-PUBLISHABLE',
};
