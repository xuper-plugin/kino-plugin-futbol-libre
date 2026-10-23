# Fútbol Libre

![Fútbol Libre](icon.png)

Partidos de hoy y canales deportivos en vivo dentro de [Kino](https://github.com/kinotvapp/kino-light), con agenda, varios servidores de respaldo y sitios espejo que se prueban solos si uno falla.

Today's matches and live sports channels inside Kino, with a schedule, several backup servers and mirror sites that are tried automatically when one fails.

## Qué trae

- **Agenda de partidos** con hora en tu zona horaria (ajuste), insignia "EN VIVO" y banderas o escudos.
- **Sección propia** (Hoy / Canales), filas por liga en Inicio, categorías y búsqueda, también dentro de "Ver más".
- **En vivo**: 19 canales deportivos con guía (los partidos que transmiten), "Partidos de hoy" y más de 100 canales extra.
- Textos en español e inglés.

## Respaldos

La agenda se lee del sitio principal (`futbollibretvplus.com`); si falla o viene vacía se usa el **respaldo 1** (`futbollibreenvivo.futbol`) y luego el **respaldo 2** (`futbol-libre.app`). Cada partido o canal trae varios reproductores (tvf90, la18hd, streamxhd, streamtp) y se prueban en orden hasta que uno entrega una lista HLS viva. En Ajustes, "Probar los sitios" dice cuáles responden.

## Desarrollo

Con el kit de plugins de Kino (carpeta `sdk/`, Node 18 o superior):

```
node sdk/validate.mjs ./futbol-libre
node sdk/run.mjs ./futbol-libre home
node sdk/run.mjs ./futbol-libre resolve "c:tvf90.espn,la18.espn"
```

## Publicar

El repositorio se llama `kino-plugin-futbol-libre` y lleva el topic **`kino-plugin`** (así lo encuentra la búsqueda de plugins de la comunidad).

Aviso: los sitios retransmiten señales de terceros sin licencia; este plugin solo las abre, no las aloja.
