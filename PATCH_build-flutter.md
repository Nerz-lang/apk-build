# Patch workflow `build-flutter.yml` (di tiap repo worker GitHub)

Bot sudah mengirim `perfMode` ("fast" | "low") di `payload`. Workflow di repo
worker (mis. `ziperr2/build1`) cuma perlu 3 perubahan kecil:

1. Taruh `workflow/build-profile.sh` ke repo worker, mis. `scripts/build-profile.sh`.

2. Ganti setup Flutter supaya pakai cache (hemat waktu build berikutnya):

```yaml
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "17" }

      - uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true          # cache SDK + pub

      - uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: gradle-${{ runner.os }}-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
          restore-keys: gradle-${{ runner.os }}-
```

3. Ganti step `flutter build apk ...` lama dengan:

```yaml
      - name: Baca payload
        id: p
        run: |
          echo '${{ inputs.payload }}' > payload.json
          echo "build_type=$(jq -r '.buildType // "release"' payload.json)" >> $GITHUB_OUTPUT
          echo "perf_mode=$(jq -r '.perfMode // "fast"' payload.json)" >> $GITHUB_OUTPUT
          echo "engine=$(jq -r '.engine // "flutter"' payload.json)" >> $GITHUB_OUTPUT

      - name: Build APK (profil)
        id: build
        env:
          BUILD_TYPE: ${{ steps.p.outputs.build_type }}
          PERF_MODE:  ${{ steps.p.outputs.perf_mode }}
          ENGINE:     ${{ steps.p.outputs.engine }}   # flutter | native
          PROJECT_DIR: project          # folder hasil unzip yang berisi pubspec.yaml
        run: bash scripts/build-profile.sh
```

Artifact tetap dinamai `apk-${{ inputs.jobId }}` (kontrak dengan bot tidak berubah).
Kalau `payload.perfMode` tidak ada (bot lama), default-nya `fast`.


## Engine NATIVE (project Android Gradle)
Bot mengirim `engine: "native"` di payload untuk Build APK (pilih "Native") dan Web To APK (pilih "Native").
- Payload `mode: "zip"` + `url` seperti biasa — isi ZIP adalah project Gradle (bukan Flutter).
- `build-profile.sh` sudah punya cabang native: cari `settings.gradle`, jalankan `gradlew assembleRelease|assembleDebug`
  (retry 1x dengan state bersih), lalu menyalin APK ke `build/app/outputs/flutter-apk/app-<type>.apk`
  sehingga langkah **upload artifact** lama tidak perlu diubah.
- Hemat waktu: beri `if: steps.p.outputs.engine != 'native'` pada step `subosito/flutter-action` dan `flutter pub get`.
- Native butuh `actions/setup-java` Java 17 (sudah ada di patch di atas); Android SDK sudah tersedia di runner `ubuntu-latest`.
- Opsional: kalau punya workflow terpisah, isi `workflows.native` di `githubworkers.json` (fallback ke workflow Flutter).
