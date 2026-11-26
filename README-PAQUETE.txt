SyB3D - PANEL DE CONTROL DE TRANSMISION
=======================================

QUE ES ESTO
  El sistema completo: draft, HUD de partida y postpartida, con su
  lanzador. Ya trae dentro el codigo, los 173 modelos de campeones,
  los 10 de monstruos y las dependencias de Node.


LO QUE HAY QUE TENER INSTALADO
------------------------------

  1. NODE.JS - OBLIGATORIO
     https://nodejs.org  -  boton LTS  -  siguiente, siguiente
     Sin esto no arranca nada.
     Comprobar:  node --version

  2. .NET 11 SDK - OBLIGATORIO
     https://dotnet.microsoft.com/download
     Hace falta para abrir SyB3D.exe y para compilar el sensor.
     Comprobar:  dotnet --list-sdks

  3. LEAGUE BROADCAST - NECESARIO PARA LA PARTIDA
     El sensor lee los datos del juego a traves de sus librerias.
     Sin el, el draft y la postpartida van, pero no hay datos en vivo.

  4. WEBVIEW2 RUNTIME - Windows 11 ya lo trae
     Windows 10 puede no tenerlo. Es gratis, de Microsoft.
     Buscar en Google: WebView2 Runtime Evergreen Bootstrapper

  5. LEAGUE OF LEGENDS


COMO ARRANCAR
-------------
  Doble clic en SyB3D.exe

  La primera vez tarda: arranca el servidor y espera a que responda.
  Si prefieres ver los mensajes, abre iniciar.bat.

  NO muevas SyB3D.exe de su carpeta: necesita encontrar server.js e
  iniciar.bat a su lado.


LOS .BAT Y CUANDO USARLOS
-------------------------
  iniciar.bat
      Arranque clasico por consola. Es lo que lanza SyB3D.exe por
      dentro. Si algo falla, abre este para leer el error.

  abrir-sensor.bat
      Reabre el sensor si se cerro sin querer. Tambien esta el boton
      "Abrir sensor" en el panel, en Estado del sistema.

  arreglar-sensor-otro-pc.bat
      PRIMERO QUE NADA en un PC nuevo. SyBSensor.csproj lleva escrita
      a mano la ruta de League Broadcast, con el nombre de usuario
      antiguo. En otro PC esa ruta no existe y el sensor no compila.
      Este .bat la cambia por una que Windows resuelve solo.

  comprobar-entorno.bat
      Lo usa iniciar.bat solo. Revisa el .NET y las librerias de
      League Broadcast, y arregla lo que cambie con cada parche.
      No hace falta abrirlo a mano.

  descargar-modelos.bat
      Solo si te faltan modelos. En este paquete ya vienen dentro.
      Baja el pack de modelos desde el release de GitHub.

  empaquetar-modelos.bat, preparar-paquete-completo.bat, subir-paquete.bat
      Solo para el PC que hace los paquetes. Aqui no los necesitas.


ERRORES COMUNES Y QUE HACER
---------------------------
  "No se pudo abrir el panel" y habla de WebView2
      Falta el WebView2 Runtime. Ver el punto 4 arriba.

  ERROR El sensor no compila
      Casi siempre es la ruta de League Broadcast.
      Doble clic en arreglar-sensor-otro-pc.bat y vuelve a probar.
      Si sigue, abre compilar-salida.txt: ahi esta el motivo exacto.

  AVISO No se encontro dotnet
      Falta el SDK de .NET 11. Ver el punto 2.

  El puerto 3000 esta ocupado
      Tienes otro SyB3D abierto. Cierralo.

  Los avisos del ingame salen sin monstruo
      Falta la carpeta ingame\overlay\assets\models. Deben ser 10 .glb.

  El draft o la postpartida salen sin campeones
      Falta la carpeta draft\models. Deben ser 173 .glb.

  ERROR al descomprimir, o rutas demasiado largas
      Descomprime en C:\SyB3D, no en el Escritorio ni en Descargas.


QUE HAY DENTRO
--------------
  SyB3D.exe             el lanzador
  iniciar.bat           arranque por consola
  server.js             el servidor del puerto 3000
  draft\                draft, overlay y modelos de campeones
  ingame\               HUD de partida y modelos de monstruos
  postgame\             pantalla de postpartida
  SyBSensor\            el sensor .NET
  Lanzador\             codigo del .exe, por si hay que recompilarlo
  node_modules\         dependencias ya instaladas


COMPROBACION EN 3 MINUTOS
-------------------------
  1. Descomprime en C:\SyB3D
  2. Doble clic en arreglar-sensor-otro-pc.bat
  3. Doble clic en SyB3D.exe
  4. Estado del sistema, Servidor en verde
  5. Postpartida, Abrir demo: si salen los campeones en 3D, todo bien
