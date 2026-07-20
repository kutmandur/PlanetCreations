# Cloudflare R2 für PlanetCreations einrichten

Die Anwendung verwendet einen privaten R2-Bucket. Temporäre Uploads und fertige
Creation-Pakete liegen im selben Bucket unter getrennten, serverseitig kontrollierten
Präfixen. Downloads erhalten erst beim Klick eine zehn Minuten gültige, signierte
GET-URL. Ein öffentlicher `r2.dev`-Endpunkt, eine Custom Domain und Bucket-CORS sind
für diesen Electron-Flow nicht erforderlich.

Offizielle Dokumentation: [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)

## 1. R2-Zugang erstellen

In Cloudflare unter **R2 > Manage R2 API Tokens** ein Token mit Object Read & Write
für genau den verwendeten Bucket erstellen. Benötigt werden:

- Account ID
- Bucket-Name
- Access Key ID
- Secret Access Key

## 2. Nicht geheime Werte setzen

In `functions/.env` eintragen:

```dotenv
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET_NAME=<bucket-name>
R2_JURISDICTION=eu
BACKUP_SIGNING_KEY_ID=backup-rsa-2026-01
```

`R2_JURISDICTION=eu` ist für den PlanetCreations-Bucket erforderlich. Bei Buckets
ohne Jurisdiktionsbeschränkung bleibt der Wert leer.

## 3. Geheimnisse in Firebase setzen

Aus dem Projektverzeichnis ausführen:

```powershell
firebase functions:secrets:set R2_ACCESS_KEY_ID
firebase functions:secrets:set R2_SECRET_ACCESS_KEY
```

Die CLI fragt die Werte verdeckt ab. Zugangsdaten gehören weder in `.env` noch in Git.

## 4. R2-Lifecycle-Regel

Im Bucket eine [Lifecycle-Regel](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
für den Präfix `temp-uploads/` anlegen, die Objekte
nach einem Tag löscht. Das ist ein zusätzliches Sicherheitsnetz für abgebrochene
Uploads; regulär löscht die Anwendung sie sofort.

## 5. Deploy

```powershell
firebase deploy --only functions,firestore:rules
```

Danach eine kleine Creation hochladen, speichern und über **Direct Install** erneut
herunterladen. In Firestore muss die Creation danach `backupStorageProvider` mit dem
Wert `cloudflare-r2` und einen `backupObjectKey` unter `creation-backups/` besitzen.
