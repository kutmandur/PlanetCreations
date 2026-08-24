# Planet Coaster 2: EFN-Berechnung nach Tracked-Ride-Scoring-Klasse

Stand der Auswertung: 23. August 2026. Grundlage ist der lokal installierte Planet-Coaster-2-Build. Die Zuordnung stammt aus `trackedrides.fdb` und `trackedridecars.fdb`; die Parameter stammen aus den ausgelieferten Lua-Modulen unter `TrackedRideScoring`.

Im Lua-Code heißt Fear weiterhin `i` wie *Intensity*. In diesem Dokument wird zur besseren Zuordnung zur Spieloberfläche konsequent `E/F/N` verwendet.

## Felder des gespeicherten Ride-Test-Verlaufs

`TrackedRideTestDataCache` speichert je Testpunkt 20 parallele Felder. Die
Zuordnung wurde gegen die Testverläufe aus Generic Islands und die
`TrackedRideMotionAnalysis`-/Scoring-Strukturen des installierten Builds geprüft:

| Index | Bedeutung | Einheit / Darstellung |
|---:|---|---|
| 0 | interner Trace-Zustand | vorzeichenlose Ganzzahl |
| 1 | verstrichene Testzeit | s |
| 2 | zurückgelegte Routendistanz | m |
| 3 | Geschwindigkeit | m/s |
| 4 | Routenposition X | m |
| 5 | Routenposition Y / Höhe | m |
| 6 | Routenposition Z | m |
| 7–10 | Fahrzeugorientierung qX/qY/qZ/qW | normiertes Quaternion |
| 11–13 | momentanes Excitement/Fear/Nausea | Spielscore |
| 14–16 | lateral/vertikal/longitudinal Beschleunigung | m/s² |
| 17–19 | lateral/vertikal/longitudinal G-Kraft | g |

Die Beschleunigungsfelder bestätigen die Achsenzuordnung direkt: Lateral und
longitudinal gilt ungefähr `G = a / 9,81`; vertikal gilt wegen der konstanten
Schwerkraftbasis `G = 1 + a / 9,81`. Eine wichtige Korrektur gegenüber der ersten
Parserfassung ist, dass Feld 5 die Höhe enthält; Feld 4 ist die horizontale
X-Position.

## Wichtige Korrektur für Boulder Blast

Die Ride-ID von **Boulder Blast** ist `Monster`. Das Fahrzeug `Monster` verweist in `trackedridecars.fdb` direkt auf **`CoasterScoring`**.

`Monster` besitzt zwar den Metadaten-Tag `Filter_Invert_NonInvert`; dieser Tag steuert jedoch die Filterung und Beschreibung des Ride-Typs, nicht die Scoring-Klasse. Die frühere Ableitung „Non-Inverted-Tag = NonInvertedCoasterScoring“ war deshalb falsch.

## Berechnungsablauf

1. Der verwendete Zug beziehungsweise das Fahrzeug wählt über `LuaScoringModule` die Scoring-Klasse.
2. Die Klasse liefert Ausgangswerte, Maximalwerte, Kurven, Glättungs- und Abklingzeiten, harte Strafen und Prestigeparameter. Einige Fahrzeuge liefern zusätzlich `BaseExcitement`, `BaseFear` und `BaseNausea`.
3. Geschwindigkeit, Beschleunigung, G-Kräfte, Jerk, Airtime, Inversionen, Lift-Hills, Drops, Ducking, Splashing, Halteabschnitte, Fahrzeugdrehung und Trigger werden über stückweise lineare Kurven in momentane E/F/N-Beiträge umgerechnet.
4. Die momentanen Werte werden geglättet und über die Fahrzeit gemittelt. Sehr niedrige Werte am Anfang einer Fahrt werden über `tLowEINAverageCorrection` teilweise aus der Mittelung entfernt.
5. Harte Grenzwertverletzungen verändern E/F/N und Prestige zusätzlich.
6. E/F/N werden auf den Bereich 0 bis 20 begrenzt.
7. Aus E/F/N wird der EFN-Anteil des Prestiges berechnet; anschließend kommt der begrenzte Szeneriebonus hinzu.

Für eine Komponente `x` bedeutet die Schreibweise `x -> (E,F,N)`, dass zwischen den angegebenen Stützpunkten linear interpoliert wird. Wenn ein Vektor Dezimalzahlen mit deutschem Komma enthält, trennen Semikolons die drei Dimensionen, zum Beispiel `(0,15; 0,25; 0,1)`. `x` ist jeweils der vom Spiel intern verwendete Messwert.

### Zeitmittel und Korrektur niedriger Anfangswerte

Für jede der drei Dimensionen wird sinngemäß gerechnet:

```text
AverageEFN = (Sum(score * dt) - LowCorrectionSum)
             / (RideTime - LowCorrectionTime)
```

Die Korrektur greift nur für E/F/N-Werte bis 1. Sie beginnt nach 15 Sekunden und erreicht nach 30 Sekunden ihre maximale Wirkung.

### EFN-Prestige

Aus den finalen E/F/N-Werten wird zunächst gebildet:

```text
RawEFN = max(0,
    10 * (10 - abs(E - 10))
  +  3 * ( 5 - abs(F -  5))
  -  3 * (10 - abs(N - 10))
)
```

Danach gilt je Scoring-Klasse:

```text
EFNPrestige = MaxPrestige
              * (1 - (1 + RawEFN / EFNDivisor) ^ (-EFNPower))

SceneryBonus = min(SceneryScore / SceneryScoreMax, 1)
               * MaxSceneryPrestigeBonus
```

Alle vorhandenen Klassen verwenden `EFNDivisor = 1.000.000` und `EFNPower = 25`. Die Maximalwerte unterscheiden sich jedoch deutlich.

## Klassenübersicht

| Scoring-Klasse | Basis | Dynamisch | Klassen-/Fahrzeugbasis E/F/N | Wesentliche Besonderheit | EFN-Prestige max. | Szeneriewert max. | Szeneriebonus max. |
|---|---|---:|---|---|---:|---:|---:|
| `CoasterScoring` | eigenständig | ja | Klasse 0/0/0 | vollständiges Coasterprofil | 1.000 | 7.500 | 100 |
| `DefaultScoring` | eigenständige Fast-Kopie des Coasterprofils | ja | Klasse 0/0/0; `PTR_Speed` 6/2/1 | E-Abklingfaktor beginnt bei 0 statt 5 | 1.000 | 7.500 | 100 |
| `NonInvertedCoasterScoring` | `CoasterScoring` | ja | 0/0/0 | Inversionen werden stark bestraft | 1.000 | 7.500 | 100 |
| `NonInvertedCoasterScoringSlow` | `NonInvertedCoasterScoring` | ja | 0/0/0 | zusätzliche Geschwindigkeitskurve für langsame Rides | 1.000 | 7.500 | 100 |
| `CascadeScoring` | `NonInvertedCoasterScoring` | ja | 0/0/0 | Wasserbasis 4/2/2 | 1.000 | 7.500 | 100 |
| `LogFlumeScoring` | eigenständig | ja | Klasse 4/3/2 | Wasser-Rides, keine Airtimewertung | 700 | 10.000 | 200 |
| `SwimsuitFlumeScoring` | eigenständig | ja | Klasse 2,5/1/2 | Flume-Ausflug, keine Airtime- oder Lateral-G-Wertung | 1.000 | 7.500 | 100 |
| `PoweredTrackedRideScoring` | eigenständig | ja | Klasse 0/0/0; Fahrzeuge 4/2/1 | keine Airtime, G-Hard-Penalties deaktiviert | 500 | 10.000 | 500 |
| `HuntsmanTrackedRideScoring` | `PoweredTrackedRideScoring` | ja | Quick Draw 4,5/2,5/1; Tracker 4/2/1 | spezielle Fahrzeugdrehung | 500 | 10.000 | 500 |
| `TransportRideScoring` | eigenständig | **nein** | Fahrzeuge 3/1/1 | statische E/F/N-Basis, Hard-Penalties deaktiviert | 300 | 37.500 | 350 |
| `PioneerCoasterScoring` | `CoasterScoring` | ja | 0/0/0 | extreme Inversionsstrafe; im aktuellen Ridebestand unbenutzt | 1.000 | 7.500 | 100 |

## Vollständige Ride-Zuordnung

Die Zahl in Klammern ist die Anzahl eindeutiger Ride-IDs im aktuellen Build. Angegeben sind jeweils `Ride-ID (Datenbankname)`.

### `CoasterScoring` (50)

`AmericanArrow (AmericanArrow)`; `Barghest (Barghest)`; `CC_Aethon (Aethon)`; `CC_Bakasura (Bakasura)`; `CC_Basilisk (Basilisk)`; `CC_BlackFalcon (Black Falcon)`; `CC_Boa (Boa)`; `CC_Bolt (Bolt)`; `CC_Buzzard (CC_Buzzard)`; `CC_Enigma (CC_Enigma)`; `CC_F25 (F25)`; `CC_FlyingCoaster (CC_FlyingCoaster)`; `CC_Infinite (Overhang)`; `CC_InvertingSuspended (InvArrow)`; `CC_IronFury (Titan)`; `CC_KidCoaster (Vector)`; `CC_LoonyTurns (LoonyTurns)`; `CC_MaliceUnchained (Malice Unchained)`; `CC_Multidimension (Multiverse)`; `CC_Multiverse (Multiverse)`; `CC_NarrowDropCoaster (CC_NarrowDropCoaster)`; `CC_NewGenInvertingSuspended (Boa)`; `CC_NextGenStandUp (CC_NextGenStandUp)`; `CC_Omnicoaster (Omnicoaster)`; `CC_PowerUp (PowerUp)`; `CC_RaidCoaster (Outamax)`; `CC_Rival (Rival)`; `CC_SLV (LoopingShuttle)`; `CC_SitdownCoaster (Omnicoaster)`; `CC_Spiral (Spiral)`; `CC_Splashdown (Splashdown)`; `CC_Sprint500 (Sprint 500)`; `CC_Stingray (Stingray)`; `CC_SuperSpin (SpinCoaster)`; `CC_TestPilot (Test Pilot)`; `CC_ThrustAir2000 (ThrustAir2000)`; `CC_Tiamat (Tiamat)`; `CC_TiltCoaster (TiltCoaster)`; `CC_Trident (Trident)`; `CC_Vector (Vector)`; `CC_ViperOne (ViperOne)`; `CC_WatercoasterSpeed (WatercoasterSpeed)`; `CC_Werewolf (Werewolf)`; `CC_Zenith (Zenith)`; `Degen (Degen)`; `GigaInvincible (Invincible)`; **`Monster (Monster)`**; `PRD_Float (PRD_Float)`; `Rage (Rage)`; `Torque (Torque)`.

### `DefaultScoring` (1)

`PTR_Speed (Speed)`.

### `NonInvertedCoasterScoring` (14)

`CC_Anubis (Anubis)`; `CC_ChildCoaster (Vector)`; `CC_ChildCoasterReturn (Vector)`; `CC_Dragon (Dragon)`; `CC_Equalizer (Equalizer)`; `CC_FamilyLaunchCoaster (Vector)`; `CC_Gnarler (Gnarler)`; `CC_GoldFever (Gold Fever)`; `CC_Interdimensional (SpinCoaster)`; `CC_ManicMouse (Manic Mouse)`; `CC_MouseHunt (Manic Mouse)`; `CC_SteelLaunched (Outamax)`; `CC_Zephyrus (Zephyrus)`; `MineTrain (Canyon Runner)`.

### `NonInvertedCoasterScoringSlow` (1)

`CC_HopTheGaps (Hop the Gaps)`.

### `CascadeScoring` (4)

`CC_BigTimber (BigTimber)`; `CC_Cascade (Cascade)`; `CC_Speed (WatercoasterSpeed)`; `CC_SuperSplash (Supersplash)`.

### `LogFlumeScoring` (3)

`RiverRapids (RiverRapids)`; `WRC_NarrowLogFlume (NarrowLogFlume)`; `WRC_WideLogFlume (WideLogFlume)`.

### `SwimsuitFlumeScoring` (7)

`BodyFlume (BodyFlume)`; `BodySlide (BodySlide)`; `BodySlideWide (BodySlideWide)`; `InnerTubeFlume (InnerTubeFlume)`; `InnerTubeFlumeDouble (InnerTubeFlumeDouble)`; `MatFlume (MatFlume)`; `RaftFlume (RaftFlume)`.

### `PoweredTrackedRideScoring` (8)

`PTR_FDVision (PTR_FDVision)`; `PTR_FamilyTrain (PTR_FamilyTrain)`; `PTR_Hoax (PTR_Hoax)`; `PTR_LunaAutos (PTR_LunaAutos)`; `PTR_PoweredCoaster (PTR_PoweredCoaster)`; `PTR_Re_Motion (PTR_Re_Motion)`; `PTR_SlotCar (PTR_SlotCar)`; `PTR_StudioTour (PTR_StudioTour)`.

### `HuntsmanTrackedRideScoring` (2)

`PTR_QuickDraw (PTR_QuickDraw)`; `PTR_Tracker (PTR_Tracker)`.

### `TransportRideScoring` (6)

`LightLine (LightLine)`; `TR_Gondola (Gondola)`; `TR_IronHorse (IronHorse)`; `TR_LandAhoy (Land Ahoy)`; `TR_SingleDeckBus (TR_SingleDeckBus)`; `TR_Trolley (TR_Trolley)`.

Damit sind alle 96 eindeutigen Tracked-Ride-IDs des untersuchten Builds erfasst. `PioneerCoasterScoring` ist vorhanden, wird aber von keiner dieser Ride-IDs referenziert.

## Gemeinsame Coaster-Basis

Diese Tabellen beschreiben `CoasterScoring`. `DefaultScoring` besitzt dieselben Kurven und Parameter mit genau einer Abweichung: Der erste Stützpunkt des E-Abklingfaktors liegt bei Wert 0 statt bei 5. Abgeleitete Klassen übernehmen die Coaster-Basis, soweit im Abschnitt „Klassenabweichungen“ nichts anderes angegeben ist.

### Grundparameter

| Parameter | E | F | N |
|---|---:|---:|---:|
| Ausgangswert der Klasse | 0 | 0 | 0 |
| Maximum | 20 | 20 | 20 |
| Prestige-Zielwert | 10 | 5 | 10 |
| Prestige-Gewichtung | 10 | 3 | -3 |
| Standard-Lerpzeit | 0,5 | 0,75 | 1,25 |
| Geschwindigkeits-Abklingen | 0,5 | 1 | 0,25 |
| Geschwindigkeits-Skala | 4 | 4 | 1,5 |
| G-Kraft-Abklingen | 3 | 0,75 | 0,75 |
| Jerk-Abklingen | 4 | 3,5 | 2,5 |

Abklingfaktoren nach aktuellem Wert:

| Dimension | Stützpunkte `Wert -> Faktor` |
|---|---|
| E | `5 -> 1`; `10 -> 0,5` |
| F | `3 -> 1`; `5 -> 0,25`; `7 -> 1` |
| N | `5 -> 1`; `10 -> 0,5` |

Für `DefaultScoring` lautet die E-Zeile stattdessen `0 -> 1`; `10 -> 0,5`.

### Geschwindigkeit und lineare Beschleunigung

| Eingabe | Stützpunkte `x -> (E,F,N)` |
|---|---|
| Geschwindigkeit | `0 -> (0,0,0)`; `20 -> (0,15; 0,15; 0)`; `30 -> (0,65; 0,25; 0,1)`; `38 -> (0,9; 0,33; 0,14)`; `45 -> (0,9; 0,4; 0,17)`; `100 -> (1,15; 1; 0,6)` |
| Faktor aus linearer Beschleunigung | `0 -> (1,1,1)`; `10 -> (2,5; 2; 1,5)` |

Die Geschwindigkeitskurve wird mit der Geschwindigkeits-Skala 4/4/1,5 kombiniert.

### Airtime

| Eingabe | Stützpunkte |
|---|---|
| Vertikale G-Kraft | `-10 -> (0,0,0)`; `-2 -> (4,0,0)`; `-1 -> (5,0,0)`; `0 -> (7,0,0)`; `5 -> (4,0,0)` |
| Lateral-G-Faktor | `0 -> 1`; `0,3 -> 1`; `0,5 -> 0` |
| Vertikalbeschleunigungs-Faktor | `-1 -> 1`; `-0,95 -> 0` |
| Airtime-Abklingen | 3/0,75/0,75; stationär 3/2/0,75 |

### Momentane G-Kräfte

| Eingabe | Stützpunkte `x -> (E,F,N)` |
|---|---|
| Lateral-G, Betrag | `0 -> (0,0,0)`; `1 -> (3,5; 2,5; 0)`; `5 -> (0,7,3)`; `8 -> (0,10,10)` |
| Vertikal-G, vorzeichenbehaftet | `-10 -> (2; 6,25; 2,5)`; `-3 -> (1; 4,25; 1,5)`; `-2 -> (0; 3,75; 1)`; `-1 -> (0; 3,5; 0,5)`; `0 -> (0,0,0)`; `5 -> (4; 3; 1,5)`; `10 -> (0; 4; 2,5)` |
| Longitudinal-G, vorzeichenbehaftet | `-12 -> (0,10,8)`; `-4 -> (9,8,3)`; `0 -> (0,0,0)`; `4 -> (10,6,1)`; `17 -> (0,8,3)` |

### Dauer von G-Kräften

Jede Zelle enthält `Zeit -> (E,F,N)`. Nicht genannte Zwischenwerte werden interpoliert.

| Richtung / Stärke | Kurve |
|---|---|
| Lateral 0,5 G | `0 -> (0,0,0)`; `5 -> (0,0,0)`; `15 -> (-1,0,0)`; `40 -> (-3,0,0)`; `60 -> (-4,0,0)` |
| Lateral 1 G | immer `(0,0,0)` |
| Lateral 2 G | `0/1 -> (0,0,0)`; `3 -> (0,2,2)` |
| Lateral 4 G | `0/1 -> (0,0,0)`; `3 -> (0,4,4)` |
| Lateral 8 G | `0/1 -> (0,0,0)`; `2 -> (0,6,6)` |
| Vertikal positiv 0,5 G | wie Lateral 0,5 G |
| Vertikal positiv 1 G | `0/5/15 -> (0,0,0)`; `40 -> (0,0,4)` |
| Vertikal positiv 2 G | `0 -> (0,0,0)`; `1 -> (0; 0; 0,5)`; `3 -> (0; 0,5; 1)` |
| Vertikal positiv 4 G | `0 -> (0,0,0)`; `1 -> (0; 0; 1,5)`; `3 -> (0; 1,5; 4)` |
| Vertikal positiv 8 G | `0 -> (0,0,0)`; `1 -> (0,0,4)`; `2 -> (0,5,8)` |
| Vertikal negativ 0,5 G | `0/5 -> (0,0,0)`; `10 -> (-1,0,1)`; `30 -> (-3,0,3)`; `60 -> (-4,0,8)` |
| Vertikal negativ 1 G | `0/5 -> (0,0,0)`; `10 -> (-2,0,2)`; `30 -> (-4,0,6)`; `60 -> (-6,0,10)` |
| Vertikal negativ 2 G | `0 -> (0,0,0)`; `2 -> (0; 0; 0,5)`; `4 -> (0,1,2)` |
| Vertikal negativ 4 G | `0 -> (0,0,0)`; `1 -> (0,0,2)`; `3 -> (0,3,7)` |
| Vertikal negativ 8 G | `0 -> (0,0,0)`; `1 -> (0,0,5)`; `2 -> (0,5,10)` |
| Longitudinal positiv 0,5/1 G | immer `(0,0,0)` |
| Longitudinal positiv 2 G | `0/2 -> (0,0,0)`; `20 -> (0,2,2)` |
| Longitudinal positiv 4 G | `0/2 -> (0,0,0)`; `20 -> (0,3,4)` |
| Longitudinal positiv 8 G | `0/2 -> (0,0,0)`; `20 -> (0,4,8)` |
| Longitudinal negativ 0,5/1 G | immer `(0,0,0)` |
| Longitudinal negativ 2 G | `0/1 -> (0,0,0)`; `10 -> (0,2,2)` |
| Longitudinal negativ 4 G | `0/1 -> (0,0,0)`; `10 -> (0,3,4)` |
| Longitudinal negativ 8 G | `0/1 -> (0,0,0)`; `10 -> (0,4,8)` |

Die Beiträge aus „Zeit über G-Grenze“ haben eine Abklingkonstante von 4/4/2.

### Jerk, Inversionen, Lift und Drop

| Eingabe | Stützpunkte `x -> (E,F,N)` |
|---|---|
| Lateral-Jerk, Betrag | `0/3 -> (0,0,0)`; `20 -> (0; 2,5; 7,5)` |
| Vertikal-Jerk, Betrag | `0/8 -> (0,0,0)`; `20 -> (0; 1,5; 2)`; `30 -> (0; 2,5; 7,5)` |
| Inversionen | `0 -> (0,0,0)`; `0,1 -> (3,5; 2; 1)`; `3 -> (2,5; 2,5; 2)`; `6 -> (0,3,5)`; `12 -> (0,4,10)` |
| Steigender Lift-Hill | `0 -> (0,0,0)`; `2 -> (1,75; 0,25; 0)`; `15 -> (2; 0,5; 0)`; `20 -> (2,25; 1; 0,25)`; `25 -> (2,5; 1,5; 0,5)`; `30 -> (2,75; 2; 0,5)`; `35 -> (3,3,1)`; `45 -> (3,5; 4,5; 1,5)` |
| Lift-Winkelmultiplikator | `0 -> (1,1,1)`; `90 -> (1; 1,5; 2)` |
| Drop | `0 -> (0,0,0)`; `1 -> (1,5; 1; 0,4)`; `100 -> (1,5; 1,25; 0,4)`; `200 -> (1,25; 0,8; 1)` |
| Drop-Winkelmultiplikator | `-90 -> (2,2,2)`; `-45 -> (1,1,1)`; `-20 -> (0,0,0)` |

Für Drops direkt nach einem Lift-Hill gelten innerhalb von 2 Sekunden und bis zu einem kumulierten Drop von 15 zusätzliche Multiplikatoren: erster Drop 2/1,5/1, zweiter Drop 1,5/1,25/1.

### Weitere Erlebnisfaktoren

| Faktor | Stützpunkte `x -> (E,F,N)` |
|---|---|
| Zeit seit letztem Ducking | `0 -> (1,2,0)`; `10 -> (2,1,0)`; `30 -> (1,0,0)` |
| Ducking-Geschwindigkeitsfaktor | `0 -> 0`; `20 -> 1` |
| Splashing | `10 -> (2,0,0)`; `30 -> (3,1,0)`; `50 -> (4,2,0)` |
| Halteabschnitt | `0 -> (0,0,0)`; `6 -> (8,7,2)`; `10 -> (7,8,4)`; `36 -> (3,7,6)` |
| Fahrzeugdrehung | `0 -> (0,0,0)`; `0,3 -> (4,1,1)`; `0,5 -> (-3,8,8)` |
| Zeit seit Reaktion | `0 -> (1,0,0)`; `10 -> (2,1,0)`; `30 -> (1,0,0)` |
| Zeit seit Trigger | `0 -> (0,1; 0; 0)`; `10 -> (2,0,0)`; `30 -> (1,0,0)` |

## Klassenabweichungen

### `NonInvertedCoasterScoring`

Es wird ausschließlich die Inversionskurve ersetzt:

| Inversionen | E | F | N |
|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 |
| ab 0,1 | -20 | 20 | 20 |

Die Punkte 0,1, 3, 6 und 12 besitzen jeweils denselben Strafvektor. Alle übrigen Werte stammen aus `CoasterScoring`.

### `NonInvertedCoasterScoringSlow`

Die Klasse übernimmt zusätzlich zur Inversionsstrafe eine früh ansteigende Geschwindigkeitskurve:

| Geschwindigkeit | E | F | N |
|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 |
| 10 | 0,15 | 0,15 | 0 |
| 20 | 0,65 | 0,25 | 0,1 |
| 30 | 0,9 | 0,33 | 0,14 |
| 38 | 0,9 | 0,4 | 0,17 |
| 45 | 1,15 | 1 | 0,6 |

### `CascadeScoring`

`CascadeScoring` übernimmt `NonInvertedCoasterScoring` und ergänzt eine Wasserbasis:

| Zeit auf Wasser | Faktor auf Wasserbasis 4/2/2 |
|---:|---:|
| 30 | 1 |
| 120 | 0,7 |

Zwischen 30 und 120 wird linear interpoliert. Die Inversionsstrafe bleibt die von `NonInvertedCoasterScoring`.

### `PioneerCoasterScoring` (derzeit unbenutzt)

Diese vorhandene Klasse ersetzt nur die Inversionskurve. Ab 0,1 Inversionen lautet der Vektor **-100/100/100**. Im untersuchten Build verweist kein Ride auf diese Klasse.

## Eigenständige Profile im Vergleich

Nicht aufgeführte Kurven entsprechen in diesen Dateien der Coaster-Basiskurve. „Deaktiviert“ bedeutet, dass die Kurve nur Nullwerte enthält oder leer ist.

| Parameter | Coaster/Default | Log Flume | Swimsuit Flume | Powered | Huntsman | Transport |
|---|---|---|---|---|---|---|
| dynamische E/F/N | ja | ja | ja | ja | ja | nein |
| Klassenbasis | 0/0/0 | 4/3/2 | 2,5/1/2 | 0/0/0 | Powered-Basis | Fahrzeugbasis 3/1/1 |
| Fahrzeugbasis | meist leer | leer | leer | 4/2/1 | 4,5/2,5/1 oder 4/2/1 | 3/1/1 |
| Prestigegewicht E/F/N | 10/3/-3 | 10/3/-3 | 10/2/-3 | 10/3/-3 | 10/3/-3 | 10/3/-3 |
| Geschwindigkeitsskala | 4/4/1,5 | 4/3/2 | 3/2/2 | 4/4/1,5 | 4/4/1,5 | entfällt |
| Airtime | aktiv | deaktiviert | deaktiviert | deaktiviert | deaktiviert | entfällt |
| Lateral-G | aktiv | aktiv | deaktiviert | aktiv | aktiv | entfällt |
| Splashing | ab 10 | ab 5,5 | ab 5,5 | deaktiviert | deaktiviert | entfällt |
| Halteabschnitt | 0/6/10/36 | 0/2/4/8/30 | 0/2/4/8/30 | deaktiviert | deaktiviert | entfällt |
| Fahrzeugdrehung | Standard | deaktiviert | deaktiviert | Standard | Spezialkurve | entfällt |
| harte G-Strafen | aktiv | aktiv, höhere Grenzen | aktiv, höhere Grenzen | deaktiviert | deaktiviert | deaktiviert |

Weitere Abweichungen der eigenständigen Profile:

- Bei `SwimsuitFlumeScoring` lautet der F-Abklingfaktor `3 -> 0,25`; `5 -> 0,25`; `7 -> 1`. Coaster, Log Flume und Powered verwenden bei 3 noch den Faktor 1.
- Beim Ducking-Abklingen verwenden Log Flume, Swimsuit Flume und Powered/Huntsman 0,3/0,3/0,3. Die Coaster-Basis verwendet 0,3/0,3/1.
- Die Inversionskurve von Log Flume, Swimsuit Flume und Powered/Huntsman ist trotz der normalerweise nicht invertierenden Fahrzeuge formal dieselbe Standardkurve wie bei `CoasterScoring`.

### Geschwindigkeitskurven

| Klasse | Stützpunkte `Geschwindigkeit -> (E,F,N)` |
|---|---|
| Coaster / Default / Powered / Huntsman | `0 -> (0,0,0)`; `20 -> (0,15; 0,15; 0)`; `30 -> (0,65; 0,25; 0,1)`; `38 -> (0,9; 0,33; 0,14)`; `45 -> (0,9; 0,4; 0,17)`; `100 -> (1,15; 1; 0,6)` |
| Non-Inverted Slow | `0 -> (0,0,0)`; `10 -> (0,15; 0,15; 0)`; `20 -> (0,65; 0,25; 0,1)`; `30 -> (0,9; 0,33; 0,14)`; `38 -> (0,9; 0,4; 0,17)`; `45 -> (1,15; 1; 0,6)` |
| Log Flume | `0 -> (0; 0; 0,1)`; `5 -> (1,1,1)` |
| Swimsuit Flume | `0 -> (0; 0; 0,1)`; `5 -> (0,75; 0,2; 0,2)`; `15 -> (1,1,1)`; `25 -> (1,2; 1,25; 1,1)`; `35 -> (0,8; 1,5; 1,25)` |

### Abweichende G- und Jerk-Kurven

| Klasse | Vertikal-G `x -> (E,F,N)` | Longitudinal bei -12 G | Vertikal-Jerk | Lateral-Jerk |
|---|---|---|---|---|
| Coaster/Default | `-10 -> (2; 6,25; 2,5)`; `-3 -> (1; 4,25; 1,5)`; `-2 -> (0; 3,75; 1)`; `-1 -> (0; 3,5; 0,5)`; danach Basiskurve | `(0,10,8)` | 0/8/20/30 | 0/3/20 |
| Log Flume/Powered | `-10 -> (0; 6,25; 2,5)`; `-3 -> (4; 4,25; 1,5)`; `-2 -> (5; 3,75; 1)`; `-1 -> (7; 3,5; 0,5)`; danach Basiskurve | `(0,10,3)` | Log 0/16/40/60; Powered 0/8/20/30 | 0/3/20 |
| Swimsuit Flume | `-10 -> (0; 6,25; 2,5)`; `-3 -> (3; 4,25; 1,5)`; `-2 -> (4; 3,75; 1)`; `-1 -> (5; 3,5; 0,5)`; danach Basiskurve | `(0,10,3)` | 0/16/40/60 | deaktiviert |

Bei Log Flume, Swimsuit Flume und Powered sind die 0,5-G- und 1-G-Zeitkurven für Lateral-G sowie positives und negatives Vertikal-G auf Null gesetzt. Swimsuit Flume setzt darüber hinaus alle Lateral-G-Zeitkurven auf Null.

### Splashing, Halteabschnitt, Reaktion und Trigger

| Klasse | Splashing | Halteabschnitt | Zeit seit Reaktion | Zeit seit Trigger |
|---|---|---|---|---|
| Coaster/Default | `10 -> 2/0/0`; `30 -> 3/1/0`; `50 -> 4/2/0` | `0 -> 0/0/0`; `6 -> 8/7/2`; `10 -> 7/8/4`; `36 -> 3/7/6` | `0 -> 1/0/0`; `10 -> 2/1/0`; `30 -> 1/0/0` | `0 -> 0,1/0/0`; `10 -> 2/0/0`; `30 -> 1/0/0` |
| Log/Swimsuit | `5,5 -> 2/0/0`; `30 -> 3/1/0`; `50 -> 4/2/0` | `0 -> 0/0/0`; `2 -> 8/4/2`; `4 -> 6/6/4`; `8 -> 3/7/5`; `30 -> 0/7/5` | `0 -> 1/0/0`; `10 -> 2/0/0`; `30 -> 1/0/0` | wie Coaster |
| Powered/Huntsman | deaktiviert | deaktiviert | wie Coaster | `0 -> 0,1/0/0`; `10 -> 1/0/0`; `30 -> 2/0/0` |

### Huntsman-Fahrzeugdrehung

Quick Draw und Tracker ersetzen die Powered-Drehkurve:

| Drehwert | E | F | N |
|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 |
| 0,015 | 1 | 0 | 0 |
| 0,075 | 5 | 3 | 3 |
| 0,12 | -3 | 8 | 8 |

### Swimsuit-Flume-Ausflug

Swimsuit Flumes besitzen zusätzliche Werte beim Verlassen der Flume:

| Faktor | E | F | N | Bereich |
|---|---:|---:|---:|---|
| positive Ausflughöhe | 0,5 | 0 | 0 | Min. 0, Mitte 2, Max. 30 |
| negative Ausflughöhe | 0 | 3 | 2 | Min. 0, Mitte 2, Max. 30 |
| Flugdistanz | 1 | 3 | 2 | Min. 3, Max. 50 |
| Startgeschwindigkeit | 0,5 | 2,5 | 1 | Min. 10, Max. 100 |

## Harte Strafen

Eine Strafe greift, wenn der Grenzwert länger als die angegebene Zeit überschritten wird. `Prestige-Mod.` ist der in der Klasse hinterlegte negative Prestigemodifikator.

### Coaster, Default und alle davon abgeleiteten Klassen

| Prüfung | Grenze | Zeit | E | F | N | Prestige-Mod. |
|---|---:|---:|---:|---:|---:|---:|
| Lateral-G | 6 | 0,2 | -2 | +4 | +2 | -0,20 |
| Vertikal-G positiv | 7 | 0,2 | -1 | +3 | +1 | -0,15 |
| Vertikal-G negativ | 7 | 0,2 | -1 | +2 | +1,5 | -0,15 |
| Longitudinal-G positiv | 10 | 0,2 | 0 | 0 | 0 | 0 |
| Longitudinal-G negativ | 6 | 0,1 | -2 | +2 | +3 | -0,10 |
| Inversion | 10 s | – | 0 | 0 | +2 | -0,15 |

### Log Flume

| Prüfung | Grenze | Zeit | E | F | N | Prestige-Mod. |
|---|---:|---:|---:|---:|---:|---:|
| Lateral-G | 6 | 0,2 | -2 | +4 | +2 | -0,20 |
| Vertikal-G positiv | 8 | 0,2 | -1 | +3 | +1 | -0,15 |
| Vertikal-G negativ | 8 | 0,2 | -1 | +2 | +1,5 | -0,15 |
| Longitudinal-G positiv | 10 | 0,2 | 0 | 0 | 0 | 0 |
| Longitudinal-G negativ | 10 | 0,2 | -2 | +2 | +1 | -0,10 |
| Inversion | 10 s | – | 0 | 0 | +2 | -0,15 |

### Swimsuit Flume

Wie Log Flume, aber positive und negative Vertikal-G-Strafen greifen bereits nach 0,1 Sekunden. Alle übrigen Werte entsprechen der Log-Flume-Strafentabelle.

### Powered, Huntsman und Transport

Alle G-Grenzen stehen auf 100 für 10 Sekunden, die Inversionsgrenze auf 100 Sekunden und sämtliche E/F/N-/Prestigemodifikatoren auf 0. Die Hard-Penalties sind damit praktisch deaktiviert.

## Farbklassifikation in der Spieloberfläche

Die Farbe ist **nicht** fest an E, F oder N gebunden, sondern bewertet, ob der jeweilige Wert gut, mittel oder schlecht ist. Diese Schwellen sind für alle Scoring-Klassen gleich:

| Wert | Rot | Gelb/Orange | Grün |
|---|---|---|---|
| Excitement | `E <= 3` | `3 < E <= 6` | `E > 6` |
| Fear | `F < 2` oder `F > 8` | `2 <= F < 4` oder `6 < F <= 8` | `4 <= F <= 6` |
| Nausea | `N > 6` | `3 < N <= 6` | `N <= 3` |

## Speicherung der Nerd-Mode-Fahrtdaten

Der Nerd Mode steht nur für Park- und Autosave-Dateien zur Verfügung. Die vollständigen
Testkurven werden gzip-komprimiert in R2 gespeichert und nicht zusammen mit dem
öffentlichen Creation-Dokument geladen. Native `.blpr2`-Dateien enthalten auch bei
genau einem Tracked Ride keine vollständigen Testkurven, sondern höchstens die fertigen
EFN-Werte. Blueprint-Creations zeigen daher keinen Nerd Mode an.

## Abgrenzung zu Flat Rides

Flat Rides verwenden diese `LuaScoringModule`-Klassen nicht. Ihre Daten liegen in `rides.fdb` und bestehen aus statischen `Simulation`-Grundwerten, Variationsmultiplikatoren und E/F/N-/Prestigewerten einzelner Sequenzoperationen. Sie bilden deshalb eine separate Berechnungsfamilie und dürfen nicht anhand der hier dokumentierten Tracked-Ride-Kurven bewertet werden.
