# Dev · lab.bingo

Le portail privé de la VM de développement : projets, serveurs HTTP détectés,
aperçus `PORT.code.lab.bingo`, favoris, recherche, thèmes et galerie d’images.
La migration native est préparée localement ; le déploiement Kubernetes/Coder
historique reste actif jusqu’à la bascule décrite dans LabOps.

## Exécution native

Le gateway Node écoute sur `127.0.0.1:8080`, l’agent Python sur
`127.0.0.1:4175`. Nginx termine TLS, authentifie via Authentik et remplace le
header `X-Authentik-Username` par l’identité vérifiée. Le gateway exige le
propriétaire `bingops` et ne publie que les ports de projets découverts.
Les identifiants SSO sont retirés avant les requêtes aux applications.
HTTP et WebSockets passent directement vers les listeners locaux ; aucun
service ni transport Coder n’est utilisé par cette version native.

Les deux listeners doivent rester sur loopback. Toute exposition directe
sans le proxy d’authentification invalide cette frontière de confiance.
La galerie reste en lecture seule et refuse chemins cachés, symlinks et
traversées. La découverte lit les sockets et répertoires courants des processus
du même utilisateur ; elle ne lit ni leurs arguments ni leurs variables.
Les projets doivent autoriser leur nom d’aperçu dans leur configuration de
serveur web, comme pour tout accès par un reverse proxy.

## Vérification locale

```sh
npm test
npm run test:agent
npm run test:browser
```

Les fixtures utilisent une identité fictive et un agent local simulé, sans
compte ni API de production. Les tests couvrent authentification obligatoire,
refus des ports non découverts, retrait des identifiants SSO, HTTP/WebSockets,
galerie et six formats d’écran. Chromium est requis pour le test navigateur.

Les fichiers `kustomization.yaml`, `deploy/` et le Dockerfile sont des artefacts
du déploiement historique. Ils ne doivent pas servir à installer la version
native. Leur présence n’établit pas que l’ancien environnement est retiré.
L’application est empaquetée par `hacks/build-dev-release.py` de LabOps ; son
identité inclut les SHA-256 des sources, assets et versions de l’environnement.
Les services systemd et les sauvegardes appartiennent au
[runbook de la VM](https://github.com/bingops-com/labops/tree/master/terraform/dev-vm).
Les préférences du navigateur restent locales. Les données personnelles et
l’authentification ne font jamais partie de l’archive publique de release.
