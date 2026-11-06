# Déclarations de compatibilité publiées

Un fichier par release **mise en ligne** (`compatibility-<commit>.json`), copie exacte de `contracts/compatibility.json`
à cette release. `compatibility-guard.test.ts` vérifie que la déclaration courante contient encore toutes les versions
de chaque fichier ici : règles, commandes, événements, formats de coffre, schémas locaux, modèles de documents (O06,
contrat 23 : « jamais retirer une version tant qu'un poste en détient »). Après une mise en ligne, ajouter le fichier de
la release livrée ; ne jamais en retirer un.
