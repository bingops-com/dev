# Dev · lab.bingo

L’environnement web de développement pour le workspace Coder `bingops/lab` : détection des serveurs HTTP par projet, aperçus `PORT.dev.lab.bingo`, favoris, recherche, thèmes clair/sombre et galerie d’images en lecture seule. La direction artistique et les polices Red Hat sont communes à Portal, Slots et Games.

## Développement et tests

Node 24+, Python 3.11+ et Chromium pour les tests navigateur. Aucune dépendance npm ou Python à installer.

```sh
npm start                 # port 8080, noms d’hôtes dev.lab.bingo / PORT.dev.lab.bingo
npm test                  # proxy HTTP/WebSocket, authentification et cookies
npm run test:agent        # découverte locale et galerie en lecture seule
npm run test:browser      # six formats, filtres, favoris, thèmes et états de session
kubectl kustomize .       # rendu des ressources, sans application au cluster
```

Le serveur attend un accès au service Coder du cluster. `createGateway({upstream, portal})` permet les tests locaux avec un Coder simulé ; les tests ne nécessitent aucun compte. `DEV_WEB_ROOT` fixe le dossier des fichiers web quand les volumes Kubernetes sont montés séparément. Les captures navigateur sont ignorées par Git.

## Architecture et déploiement

- `server.mjs` : shell statique, proxy des alias HTTP/WebSocket et inventaire via l’application Coder 4175. Les projets restent privés et l’authentification est déléguée à Coder/Authentik.
- `web/` : HTML/CSS/JS et polices locales, sans service tiers ni framework à compiler.
- `workspace/agent.py` : galerie et inventaire, uniquement sur `127.0.0.1:4175` dans le workspace. Sur un ancien workspace sans supervision au démarrage, lancer `bash workspace/start.sh` : une session Screen détachée conserve le service et relance son worker après un arrêt. Le démarrage répété est sans effet si l’inventaire répond déjà.
- `kustomization.yaml`, `deploy/` : Deployment `dev`, Service `dev` et ConfigMaps dans `coder`, plus le code de l’agent dans `coder-workspaces`. Les namespaces et le workspace appartiennent à Coder, pas à cette application.
- `Dockerfile` : image autonome reproductible, construite et vérifiée en CI.

Sur `labprod`, une Application Argo CD **`dev-labprod`** suit ce dépôt. Le workload utilise une image officielle Node épinglée par digest et monte le code versionné depuis des ConfigMaps en lecture seule. Leur nom dépend du contenu : une modification du serveur, des assets ou des polices remplace le Pod automatiquement. Cette application sans dépendances ne requiert donc aucun registre privé ni identifiant de pull. Le Dockerfile offre aussi le packaging autonome quand une image applicative est souhaitée.

LabOps conserve la déclaration Argo CD, l’autorisation du dépôt, le DNS privé, l’ingress et le certificat DNS-01 existants. La migration remplace le backend de l’ingress par le Service `dev` ; le certificat, Coder et les serveurs du workspace restent en place. Le déploiement `dev` ne monte ni home, ni secret, ni jeton Kubernetes. Il tourne sans root et avec un système de fichiers en lecture seule.

L’agent du workspace est fourni par le ConfigMap `coder-workspace-gallery`, déclaré ici et monté par le template Coder. Sa mise à jour ne relance pas le workspace : redémarrer uniquement son listener 4175 pour adopter une nouvelle version. Les processus des projets ne sont pas lancés par Dev.

## Détection et données privées

L’agent associe les sockets TCP en écoute aux processus du même utilisateur dont le dossier courant est dans `/home/coder/projects`, puis effectue un HEAD HTTP local. Il ne lit ni arguments de commande, ni environnement, ni Git, ni fichiers de configuration. Les outils Coder/Codex/Claude, SSH et assistants navigateur sont exclus ; les réponses HTTP ne sont pas conservées. Les résultats sont bornés à 64 ports, 100 projets, huit requêtes parallèles et cinq secondes de cache. L’interface se rafraîchit toutes les dix secondes tant qu’elle est visible.

Les sockets non HTTP, les processus hors projets, les listeners TLS et ceux liés exclusivement à une interface non loopback ne sont pas reconnus automatiquement. La saisie de port reste disponible pour les routes compatibles avec le proxy Coder. Une limite atteinte est signalée. Les états connexion requise, détection indisponible, données périmées et aucun serveur sont distincts.

`GET /api/workspace` passe par le proxy Coder vers une unique route de l’agent. Aucune URL arbitraire ou commande n’est acceptée. L’inventaire nécessite une session Coder propriétaire ; les réponses ne sont pas mises en cache par le navigateur. Le retour de connexion est fixe. Les URL de callback et leurs paramètres sensibles ne sont jamais journalisés. Les favoris et le thème sont conservés localement dans le navigateur, sans identifiant.

## Reconstruction et vérification

1. Reconstituer DNS, issuer TLS, Coder et les namespaces selon le [runbook LabOps](https://github.com/bingops-com/labops/tree/master/apps/workloads/coder).
2. Réconcilier `dev-labprod` ; les ConfigMaps et le Pod sont reconstruits depuis Git de manière idempotente.
3. Adopter le template Coder avec le montage et la supervision de l’agent. Pour rétablir un workspace existant sans le redémarrer, exécuter `bash workspace/start.sh`, puis démarrer les serveurs des projets. Vérifier `curl --fail http://127.0.0.1:4175/api/dev/status`. Le helper ne change ni Coder ni Kubernetes et ne démarre aucun projet. Sa session détachée survit à la fermeture du terminal et relance le worker sous deux secondes ; un arrêt complet du workspace nécessite le démarrage prévu par le template ou un nouvel appel au helper. L’état de verrouillage dans `~/.local/state/dev-workspace` est généré et ne nécessite aucune restauration.
4. Vérifier `/healthz`, le TLS de `dev.lab.bingo`, le 401 de `/api/workspace` sans session et la redirection d’un alias vers Coder. Après connexion, démarrer/arrêter un serveur et vérifier son apparition/disparition, puis ouvrir sa page et un serveur WebSocket.

Aucun nouvel input sensible n’est nécessaire. Les comptes Coder/Authentik, l’issuer DNS-01 et les sauvegardes du home ont leurs procédures de récupération dans LabOps. Les tests CI utilisent exclusivement des données factices. Les licences des polices copiées de la famille lab.bingo figurent dans `web/fonts/LICENSE`.
