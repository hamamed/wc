Put the Android app here as  hama.apk

The website's "Get the app" banner links to /download/hama.apk, so the file
must be named exactly  hama.apk  and placed in this folder:

  public/download/hama.apk

On the VPS:
  scp app-debug.apk root@YOUR_SERVER_IP:/root/worldcup-predictor/public/download/hama.apk

No restart needed — it's a static file, served immediately at:
  https://koydam.com/download/hama.apk
