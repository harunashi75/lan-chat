# LAN Chat

Chat en mémoire (état complet envoyé une seule fois à l'arrivée, puis des deltas : nouveau message, réactions, liste des présents), vocal et partage d'écran WebRTC. Le serveur Python transmet le chat, la présence et les signaux WebRTC via HTTP/WebSocket sur un seul port. Les médias circulent directement entre les participants.

## Démarrer

Prérequis : Python 3.11+ avec `venv` et `pip`. Pour Electron : Node.js 22.12+ et npm.

Linux/macOS :

```bash
./start.sh
```

Windows : lancer `start.bat` avec une installation standard de Python (commande `py`).

Le premier lancement prépare `.venv` et installe `requirements.txt`. Ouvrir `http://localhost:8765`. Le tunnel Pinggy est désactivé par défaut : le salon reste local. Pour obtenir un lien HTTPS public (SSH requis), activez-le et protégez le salon :

```bash
LAN_CHAT_TUNNEL=1 LAN_CHAT_PASSWORD='mon-mot-de-passe' ./start.sh
```

Les invités sur le réseau doivent utiliser une URL HTTPS pour démarrer une capture ou le microphone dans un navigateur. Une adresse `http://192.168.…` ne fournit pas un contexte sécurisé. `localhost` est une exception. Le tunnel fournit HTTPS pour l'accès distant ; un reverse proxy HTTPS local est une autre possibilité.

Pour l'application de bureau, après préparation de Python :

```bash
npm ci
npm run install:desktop
npm start
```

Choisir Hôte ou Client. Un serveur LAN Chat déjà présent sur le port configuré est réutilisé. Le menu « LAN Chat » (touche Alt si masqué) permet de changer de salon et d'afficher l'état du GPU. L'accélération graphique conserve les réglages par défaut de Chromium ; cela ne garantit pas qu'un encodeur matériel soit disponible sur chaque machine.

## Packager l'application (Linux et Windows)

L'application de bureau est Electron. Le paquet embarque le serveur Python gelé avec PyInstaller (`resources/server`), donc l'utilisateur final n'a besoin ni de Python ni de Node.

```bash
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt   # PyInstaller
npm run dist:linux   # release/LAN-Chat-<version>-linux-x86_64.AppImage
npm run dist:win     # release/LAN-Chat-<version>-win-x64.exe (installateur NSIS)
```

Le serveur est gelé avec PyInstaller, qui ne cross-compile pas : construire chaque cible sur son système. Le workflow GitHub `Release` le fait automatiquement (Actions > Release > Run workflow, ou en poussant un tag `v*`, qui publie aussi les fichiers dans la release). Pour tester sans installer : `release/linux-unpacked/lan-chat` après `dist:linux`.

Remarques :
- Les paquets ne sont pas signés : Windows SmartScreen affichera un avertissement au premier lancement, et l'AppImage doit être rendue exécutable (`chmod +x`). Sans FUSE : `./LAN-Chat-*.AppImage --appimage-extract-and-run`.
- L'application packagée lance son serveur sur le port `LAN_CHAT_PORT` (8765 par défaut) ; Windows peut demander d'autoriser le réseau local dans son pare-feu pour que d'autres machines rejoignent le salon.
- L'icône est dessinée en SVG (`static/icon.svg`, aussi utilisée comme favicon et logo). `assets/icon.png` (fenêtres Electron et paquets) en est dérivée : `node scripts/make-icon.cjs` après modification du SVG.
- Version : modifier `version` dans `package.json`.

## Interface

- Barre latérale : salon vocal (rejoindre, partager l'écran, voir les partages), liste des présents et pastille de profil qui ouvre les paramètres. Sur mobile elle devient un menu ouvert par le bouton ☰.
- Fenêtre **Paramètres** (⚙️, Échap pour fermer) : Profil (nom), Apparence (couleur d'accent bleu/violet/vert/rose, thème clair/sombre/système, emojis animés), Notifications, Partage d'écran (qualité, son), Diagnostic, À propos (lien du salon, confidentialité).
- « X écrit… » : un indicateur de frappe (au plus un signal toutes les 3 s par personne, rien n'est conservé côté serveur).
- Notifications : petit son à l'arrivée d'un message quand la fenêtre n'est pas active, sons quand quelqu'un rejoint ou quitte le vocal où vous êtes, et compteur de messages non lus dans le titre de l'onglet et sur son icône. Les sons sont synthétisés par le navigateur (aucun fichier audio), réglables et désactivables.

## Qualité vidéo

| Profil | Capture demandée au maximum | Plafond vidéo par destinataire |
| --- | --- | --- |
| Texte | 1920×1080, 20 ips | 6 Mbit/s |
| Équilibré | 1920×1080, 30 ips | 10 Mbit/s |
| Fluide | 1920×1080, 60 ips | 16 Mbit/s |
| Détaillé | 2560×1440, 30 ips | 16 Mbit/s |

Ces objectifs restent limités par la source, le navigateur, l'encodeur et le réseau. Changer de profil pendant le partage applique les contraintes et les paramètres d'encodage sans recapturer l'écran. WebRTC conserve son contrôle de congestion ; le débit maximal n'est pas un débit garanti. Les indices de contenu privilégient le texte, le détail ou le mouvement suivant le profil.

Le budget global vidéo de l'émetteur est de 40 Mbit/s par défaut, réparti entre les spectateurs. Chaque participant peut désactiver « Recevoir les partages », ce qui retire les pistes envoyées vers lui. Le microphone est envoyé uniquement entre membres du vocal. Le son du partage reste indépendant du vocal.

Dans Electron, le sélecteur système est utilisé lorsqu'il est disponible ; sinon une fenêtre affiche les écrans et fenêtres à sélectionner. Le repli propose le son système sous Windows. Sous Linux/Wayland et macOS, sa disponibilité dépend du sélecteur système, des permissions et du moteur de capture. Un message indique lorsqu'aucune piste sonore n'a été capturée.

Les paramètres > « Diagnostic » affichent la qualité réellement envoyée/reçue, le codec, le débit, les pertes cumulées à la réception, les gels si disponibles, le RTT et le type de candidat ICE (`host`, `srflx`, `relay`). Les limitations CPU/bande passante viennent des statistiques WebRTC. Le RTT réseau n'est pas une mesure de latence écran-à-écran.

## Configuration réseau

Variables d'environnement (héritées aussi par le serveur lancé par Electron) :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `LAN_CHAT_HOST` | `0.0.0.0` | Interface d'écoute |
| `LAN_CHAT_PORT` | `8765` | Port HTTP + WebSocket |
| `LAN_CHAT_TUNNEL` | `0` | `1` active le tunnel public Pinggy |
| `LAN_CHAT_PASSWORD` | vide | Mot de passe du salon (optionnel, recommandé avec le tunnel) |
| `LAN_CHAT_ICE_SERVERS` | STUN Google | Liste JSON de serveurs STUN/TURN |
| `LAN_CHAT_VIDEO_BUDGET` | `40000000` | Budget vidéo total en bits/s, hors audio et surcoûts |
| `LAN_CHAT_PUBLIC_ORIGINS` | vide | Origines HTTPS autorisées derrière un proxy, séparées par des virgules |

Exemple, avec un serveur TURN que vous gérez :

```bash
export LAN_CHAT_ICE_SERVERS='[{"urls":"stun:stun.example.net:3478"},{"urls":["turn:turn.example.net:3478?transport=udp","turns:turn.example.net:5349?transport=tcp"],"username":"UTILISATEUR","credential":"IDENTIFIANT_TEMPORAIRE"}]'
./start.sh
```

Le serveur STUN Google conserve la découverte publique déjà utilisée par le projet. Pour un LAN sans service externe, définir `LAN_CHAT_ICE_SERVERS='[]'`. Certains réseaux nécessitent TURN. Pinggy transporte le site et la signalisation, pas les flux média WebRTC. La configuration `/config` est destinée aux navigateurs : les identifiants TURN qui y figurent sont donc visibles. Utiliser des identifiants temporaires pour une installation publique. Aucun service TURN n'est provisionné automatiquement.

Chaque navigateur ouvre une session avec un jeton secret (jamais diffusé) : le chat, les réactions et les signaux passent par le WebSocket et sont attribués à l'identité authentifiée de la connexion, ce qui empêche d'écrire au nom d'un autre. Le jeton permet aussi de reprendre sa session après une coupure réseau. Chaque connexion a sa propre file d'envoi : un client lent ou bloqué est déconnecté (il se resynchronise en se reconnectant) sans retarder les autres. Le débit des messages est limité par connexion (chat/réactions : rafale de 10 puis 2/s ; présence : 20 puis 5/s ; signaux WebRTC : 300 puis 150/s) et une connexion qui insiste est fermée. Les emojis animés (Noto, Google) sont désactivés par défaut : ils chargent des images depuis `fonts.gstatic.com`, ce qui révèle l'IP des participants à Google et ne fonctionne pas hors-ligne. Le réglage « Emojis animés » du panneau Settings les active pour ce navigateur ; sinon, un emoji seul s'affiche en grand avec la police du système. Il n'y a pas de comptes. Sans `LAN_CHAT_PASSWORD`, le lien donne accès au salon ; avec, le mot de passe est exigé pour ouvrir le WebSocket et pour recevoir la configuration ICE (donc les identifiants TURN). Il n'y a pas de limitation de tentatives : choisissez un mot de passe long. L'application reste destinée à un groupe de confiance.

## Structure du code

```
server.py              point d'entrée du serveur (démarrage, tunnel)
lanchat/               serveur : config, room (état, file d'envoi, rate-limit), handlers (messages),
                       routes (HTTP + boucle WebSocket), tunnel (Pinggy), app (fabrique)
index.html             structure de la page uniquement
static/app.js          assemblage des modules et des événements serveur
static/session.js      identité, WebSocket, reconnexion, présence
static/chat/           utilisateurs, messages et réactions, saisie et emojis, connexion, mise en page
static/media/          WebRTC : state, profiles, tiles, peers, capture, diagnostics
static/settings.js     fenêtre Paramètres et thème
main.js, electron/     Electron : fenêtres et cycle de vie, serveur intégré, capture d'écran
tests/                 tests serveur (unittest) et test navigateur de bout en bout (Playwright)
scripts/               construction du serveur gelé, icône, lanceur Python portable
```

## Préparer un futur rendu vidéo / SFU

- `static/media/` contient la capture, les profils, les émetteurs, la négociation, les sorties audio/vidéo et les diagnostics, séparés du chat. Il ne parle jamais au socket directement : `static/session.js` porte l'identité, le WebSocket et la présence (événements `on(...)`, `send`, `updatePresence`), `static/app.js` l'assemblage, `static/chat/` le chat (utilisateurs, messages et réactions, saisie et emojis, connexion, mise en page mobile), `static/settings.js` la fenêtre Paramètres, `static/emoji.js` et `static/util.js` les utilitaires, `static/style.css` le style. Ce sont des modules ES sans variables globales partagées ; `window.__lanChat` n'expose qu'un accès en lecture pour le test navigateur.
- `addOrUpdateScreenTile` est le point de rendu des flux reçus. Un futur lecteur peut le remplacer sans changer la signalisation du chat.
- `syncPeerTracks`, `createPeerConnection` et `handleWebRTCSignals` constituent le chemin actuel de transport média en maillage.
- `/config` centralise ICE et budget, et annonce explicitement `mediaTopology: "mesh"`.

Le projet utilise toujours une connexion média par participant concerné. Un SFU n'est pas implémenté : il faudra remplacer ce chemin par un client SFU, ajouter un serveur média et la gestion de ses autorisations/publications/abonnements. Les profils de capture et la présentation des flux pourront être conservés. Un SFU réduira le débit sortant des émetteurs pour les grands groupes ; son choix et son hébergement restent à déterminer selon la charge réelle.

## Vérifier

```bash
npm ci
.venv/bin/pip install -r requirements-dev.txt   # ruff
npx playwright install chromium
npm run lint         # eslint (front, Electron, tests) + ruff (Python)
npm run test:server  # tests unittest du serveur
npm run test:media   # test navigateur de bout en bout
npm test             # les deux tests
```

Les scripts npm passent par `scripts/venv-python.cjs`, ils fonctionnent donc aussi sous Windows. Une CI GitHub (`.github/workflows/ci.yml`) lance ruff et les tests serveur sous Python 3.11 et 3.13, puis eslint et le test navigateur.

Les tests serveur vérifient présence, routage des signaux, chat et réactions (stockées par identifiant) par WebSocket, départs, protection des identités par jeton, reprise de session et origines. Le test navigateur utilise deux à quatre clients (dont un invité sur une page `http://` non sécurisée, sans `crypto.randomUUID`) avec de vrais échanges WebRTC, une capture canvas et du son synthétiques : réception vidéo, partage bidirectionnel, changement de profil, vocal, isolation audio, désabonnement, arrêt/reprise, reconnexion et arrivée tardive. L'option désactivant mDNS est limitée au navigateur de test pour les environnements sans résolution multicast.

La capture réelle d'écran, le sélecteur Electron, le son système et l'accélération matérielle doivent être validés sur les machines cibles. Pour comparer les performances : même contenu, même résolution, même durée, relever CPU/GPU et diagnostic reçu sur une autre machine, en Ethernet puis en Wi-Fi. Le test synthétique ne mesure pas les performances 1080p60 d'un poste réel.

## Messages de couleur sous Wayland

Des messages `wayland_wp_color_manager.cc`, `Unable to set image transfer function` ou `Failed to populate image description` viennent du chemin de gestion des couleurs entre Chromium et le compositeur Wayland. Ils ne prouvent pas à eux seuls un plantage ni une panne WebRTC.

Pour tester le contournement ciblé :

```bash
npm run start:wayland
```

Ce mode désactive `WaylandWpColorManagerV1` pour cette exécution, tout en conservant les réglages GPU par défaut. Il contourne l'intégration de ce protocole de couleurs/HDR : privilégier `npm start` si la gestion HDR est nécessaire et fonctionne correctement. Aucun réglage système n'est modifié.

Source Chromium : https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/ozone/platform/wayland/host/wayland_wp_color_manager.cc

Les arrêts anormaux du processus de rendu ou des processus auxiliaires sont désormais signalés séparément dans le terminal. Fermer volontairement la dernière fenêtre quitte normalement l'application sous Linux.
