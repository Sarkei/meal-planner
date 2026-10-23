# meal-planner

Privates Repository `Sarkei/meal-planner`. Der Inhalt besteht aus dem
unveränderten GitLab-Template für .NET-Core-Projekte (`dotNET-Core.gitlab-ci.yml`).
Es gibt keinen Code, der Mahlzeiten plant: keine Rezepte, keine Datenhaltung,
keine Oberfläche. Das Repository dient derzeit ausschließlich als Gerüst, um
eine .NET-Konsolenanwendung samt CI-Pipeline aufzusetzen.

## Funktionen

Der gesamte Anwendungscode steht in `Program.cs` und gibt eine Zeile auf der
Konsole aus:

```
Hello World!
```

Mehr passiert nicht. Es werden keine Argumente ausgewertet, keine Dateien
gelesen oder geschrieben, keine Netzwerkverbindung aufgebaut. Die Pipeline
baut und testet dieses Programm, mehr nicht.

## Technik

Angaben aus `dotnetcore.csproj` und `.gitlab-ci.yml`:

| Merkmal | Wert |
| --- | --- |
| Projekt-SDK | `Microsoft.NET.Sdk` |
| Ausgabetyp | `Exe` (Konsolenanwendung) |
| Zielframework | `net7.0` |
| Sprache | C# (`namespace dotnetcore`) |
| Externe Pakete | keine |
| CI-Image | `mcr.microsoft.com/dotnet/sdk:7.0` |
| CI-Stages | `build`, `test`, `deploy` |
| Gitpod-Image | `gitpod/workspace-dotnet` |

Die CI cached `obj/project.assets.json`, die NuGet-Metadaten und das
Verzeichnis `.nuget`. `deploy` ist ein Platzhalter und führt nur
`echo "Define your deployment script!"` aus.

## Projektstruktur

Alle Dateien liegen im Wurzelverzeichnis, es gibt keine Unterordner:

```
.
├── Program.cs            Einstiegspunkt, gibt "Hello World!" aus
├── dotnetcore.csproj     Projektdatei (net7.0, Exe)
├── .gitlab-ci.yml        Pipeline: restore, build, test, deploy-Platzhalter
├── .gitpod.yml           Cloud-Workspace: baut und startet automatisch
├── .gitattributes        "* text=auto"
├── .gitignore            .NET-Build-Artefakte, Obsidian, Editor-, OS-Dateien
├── CONTRIBUTING.md       Text von GitLab B.V. (DCO, Code of Conduct)
├── LICENSE               MIT, Copyright GitLab B.V.
└── README.md             bisheriges Template-README (GitLab-Pipeline-Beispiel)
```

## Start

Voraussetzung ist ein .NET-SDK in Version 7.0.

```
dotnet restore
dotnet build
dotnet run
```

Ausgabe: `Hello World!`. Tests sind im Repository nicht vorhanden, der
CI-Job `tests` ruft dennoch `dotnet test --no-restore` auf und findet
schlicht keine Testprojekte.

Alternativ über Gitpod: `.gitpod.yml` startet `dotnet build` als Init-Task
und danach `dotnet run`.

## Konfiguration

Es gibt keine Konfigurationsdateien: kein `.env`, kein `.env.example`,
kein `appsettings.json`. Das Programm liest keine Umgebungsvariablen.
Die Pipeline nutzt ausschließlich die in `.gitlab-ci.yml` definierten
Variablen `OBJECTS_DIRECTORY`, `NUGET_PACKAGES_DIRECTORY` und
`SOURCE_CODE_PATH`.

## Hinweise

- Der Name passt nicht zum Inhalt. Wer hier einen Meal-Planner erwartet,
  findet das GitLab-`dotnet new console`-Beispiel vor.
- `LICENSE` und `CONTRIBUTING.md` sind unverändert von GitLab B.V.
  übernommen (MIT, Copyright 2019–present GitLab B.V.) und nennen
  GitLab als Rechteinhaber, nicht den Repository-Inhaber.
- Das alte `README.md` beschreibt eine Pipeline mit `stages`-Block und
  `microsoft/dotnet:latest`; die aktuelle `.gitlab-ci.yml` verwendet
  `sdk:7.0` und definiert keine `stages`-Liste. Die Dokumentation ist
  damit veraltet.
- `SOURCE_CODE_PATH: '*/*/'` erwartet ein verschachteltes Quellverzeichnis,
  die Projektdatei liegt aber im Wurzelverzeichnis. Die Cache-Pfade der
  Pipeline greifen deshalb ins Leere.
- `.gitignore` enthält Obsidian-Regeln und doppelte Kommentarblöcke; sie
  stammen aus einer Notiz-Vorlage und haben mit .NET nichts zu tun.
- `net7.0` ist außerhalb des Support-Zeitraums; ein Update auf ein
  aktuelles LTS-Target wäre sinnvoll, sobald echter Code entsteht.
