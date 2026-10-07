; ──────────────────────────────────────────────────────────────────────────────
; Custom NSIS para DELPA Gestion PRO (electron-builder lo incluye automáticamente:
; nsis.include por defecto = build/installer.nsh).
;
; v1.42.3 — Borrar el certificado AFIP previo en cada instalación/actualización, para
; que el cliente arranque limpio. Clientes que venían de v1.42.0 tenían el certificado
; legacy de DELPA guardado en userData/afip-cert y la versión nueva no lo pisa (flag
; .migrated), así que se elimina acá. Se cubren los dos nombres posibles de la carpeta
; userData (name=panel-financiero y productName="DELPA Gestion PRO"). RMDir /r sobre una
; carpeta inexistente es no-op, así que es seguro.
; ──────────────────────────────────────────────────────────────────────────────

!macro customInstall
  RMDir /r "$APPDATA\panel-financiero\afip-cert"
  RMDir /r "$APPDATA\DELPA Gestion PRO\afip-cert"
!macroend
