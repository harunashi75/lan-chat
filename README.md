# LAN Chat

Chat en mémoire, vocal et partage d'écran WebRTC. Le serveur Python transmet le chat, la présence et les signaux WebRTC via HTTP/WebSocket sur un seul port. Les médias circulent directement entre les participants.

## Démarrer

Prérequis : Python 3.10+ avec `venv` et `pip`. Pour Electron : Node.js 22.12+ et npm.

Linux/macOS :

```bash
./start.sh
```

Windows : lancer `start.bat` avec une installation standard de Python (commande `py`). Le dossier `python/` historique n'est plus utilisé : sa distribution embarquée ne fournit pas le même environnement `venv`/`pip`.

Le premier lancement prépare `.venv` et installe `requirements.txt`. Ouvrir `http://localhost:8765`. Le tunnel Pinggy est conservé ; SSH doit être installé pour obtenir le lien HTTPS public. Pour rester uniquement en local :

```bash
LAN_CHAT_TUNNEL=0 ./start.sh
```

Les invités sur le réseau doivent utiliser une URL HTTPS pour démarrer une capture ou le microphone dans un navigateur. Une adresse `http://192.168.…` ne fournit pas un contexte sécurisé. `localhost` est une exception. Le tunnel fournit HTTPS pour l'accès distant ; un reverse proxy HTTPS local est une autre possibilité.

Pour l'application de bureau, après préparation de Python :

```bash
npm ci
npm run install:desktop
npm start
```

Choisir Hôte ou Client. Un serveur LAN Chat déjà présent sur le port configuré est réutilisé. Le menu « LAN Chat » (touche Alt si masqué) permet de changer de salon et d'afficher l'état du GPU. L'accélération graphique conserve les réglages par défaut de Chromium ; cela ne garantit pas qu'un encodeur matériel soit disponible sur chaque machine.

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

« Diagnostic vidéo » affiche la qualité réellement envoyée/reçue, le codec, le débit, les pertes cumulées à la réception, les gels si disponibles, le RTT et le type de candidat ICE (`host`, `srflx`, `relay`). Les limitations CPU/bande passante viennent des statistiques WebRTC. Le RTT réseau n'est pas une mesure de latence écran-à-écran.

## Configuration réseau

Variables d'environnement (héritées aussi par le serveur lancé par Electron) :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `LAN_CHAT_HOST` | `0.0.0.0` | Interface d'écoute |
| `LAN_CHAT_PORT` | `8765` | Port HTTP + WebSocket |
| `LAN_CHAT_TUNNEL` | `1` | `0` désactive Pinggy |
| `LAN_CHAT_ICE_SERVERS` | STUN Google | Liste JSON de serveurs STUN/TURN |
| `LAN_CHAT_VIDEO_BUDGET` | `40000000` | Budget vidéo total en bits/s, hors audio et surcoûts |
| `LAN_CHAT_PUBLIC_ORIGINS` | vide | Origines HTTPS autorisées derrière un proxy, séparées par des virgules |

Exemple, avec un serveur TURN que vous gérez :

```bash
export LAN_CHAT_ICE_SERVERS='[{"urls":"stun:stun.example.net:3478"},{"urls":["turn:turn.example.net:3478?transport=udp","turns:turn.example.net:5349?transport=tcp"],"username":"UTILISATEUR","credential":"IDENTIFIANT_TEMPORAIRE"}]'
./start.sh
```

Le serveur STUN Google conserve la découverte publique déjà utilisée par le projet. Pour un LAN sans service externe, définir `LAN_CHAT_ICE_SERVERS='[]'`. Certains réseaux nécessitent TURN. Pinggy transporte le site et la signalisation, pas les flux média WebRTC. La configuration `/config` est destinée aux navigateurs : les identifiants TURN qui y figurent sont donc visibles. Utiliser des identifiants temporaires pour une installation publique. Aucun service TURN n'est provisionné automatiquement.

Chaque navigateur ouvre une session avec un jeton secret (jamais diffusé) : le chat, les réactions et les signaux passent par le WebSocket et sont attribués à l'identité authentifiée de la connexion, ce qui empêche d'écrire au nom d'un autre. Le jeton permet aussi de reprendre sa session après une coupure réseau. Le salon n'a pas de comptes ni de mot de passe. Le lien donne accès au salon ; l'application reste destinée à un groupe de confiance.

## Préparer un futur rendu vidéo / SFU

- `media.js` contient la capture, les profils, les émetteurs, la négociation, les sorties audio/vidéo et les diagnostics, séparés du chat.
- `addOrUpdateScreenTile` est le point de rendu des flux reçus. Un futur lecteur peut le remplacer sans changer la signalisation du chat.
- `syncPeerTracks`, `createPeerConnection` et `handleWebRTCSignals` constituent le chemin actuel de transport média en maillage.
- `/config` centralise ICE et budget, et annonce explicitement `mediaTopology: "mesh"`.

Le projet utilise toujours une connexion média par participant concerné. Un SFU n'est pas implémenté : il faudra remplacer ce chemin par un client SFU, ajouter un serveur média et la gestion de ses autorisations/publications/abonnements. Les profils de capture et la présentation des flux pourront être conservés. Un SFU réduira le débit sortant des émetteurs pour les grands groupes ; son choix et son hébergement restent à déterminer selon la charge réelle.

## Vérifier

```bash
.venv/bin/python -m unittest discover -s tests -v
npx playwright install chromium
npm run test:media
```

Sous Windows, utiliser `.venv\Scripts\python.exe` pour les tests Python.

Les tests serveur vérifient présence, routage des signaux, chat et réactions par WebSocket, départs, protection des identités par jeton, reprise de session et origines. Le test navigateur utilise deux puis trois clients avec de vrais échanges WebRTC, une capture canvas et du son synthétiques : réception vidéo, partage bidirectionnel, changement de profil, vocal, isolation audio, désabonnement, arrêt/reprise, reconnexion et arrivée tardive. L'option désactivant mDNS est limitée au navigateur de test pour les environnements sans résolution multicast.

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
