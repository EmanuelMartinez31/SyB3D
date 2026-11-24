CreateObject("WScript.Shell").Run "C:\Windows\System32\cmd.exe /c curl.exe -s -m 20 http://localhost:3000/mapa/abrir > ""%TEMP%\mapa-respuesta.txt"" 2>&1", 0, True
Set fso = CreateObject("Scripting.FileSystemObject")
If fso.FileExists(fso.BuildPath(fso.GetSpecialFolder(2), "mapa-respuesta.txt")) Then
  Set f = fso.OpenTextFile(fso.BuildPath(fso.GetSpecialFolder(2), "mapa-respuesta.txt"), 1)
  MsgBox "Respuesta del HUD:" & vbCrLf & vbCrLf & f.ReadAll(), 64, "Mapa + camara (r136)"
  f.Close
End If
