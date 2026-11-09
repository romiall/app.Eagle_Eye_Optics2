# Rendu « golden » des documents (D01, D02)

`render-demo.test.ts` génère les PDF de démonstration (données **fictives**, jeu `DEMO_DOCUMENTS`) avec
le vrai moteur jsPDF et en contrôle le rendu. La revue visuelle initiale a été faite le 2026-11-09 (section
« Revue du 2026-11-09 » en fin de fichier) et les références sont figées dans `tests/fixtures/document-snapshots/` ;
l'impression réelle (A4 noir et blanc, ticket 80 mm) reste à faire.

## Procédure de revue visuelle (D02, « Inspecter tous PDFs et impression réelle A4 »)

1. Générer les fichiers :

   ```text
   # PowerShell
   $env:EEO_DOCUMENT_GOLDEN = 'render'; npx vitest run tests/frontend/documents/golden
   # sous Bash
   EEO_DOCUMENT_GOLDEN=render npx vitest run tests/frontend/documents/golden
   ```

   Résultat dans `test-results/documents/` (ignoré par git) : un `.pdf`, un `.txt` (texte de mise en
   page) et un `.svg` par page pour chaque document, plus `index.html`.

2. Ouvrir `test-results/documents/index.html`, puis chaque PDF dans la visionneuse du navigateur, et
   **imprimer en A4, noir et blanc, à l'échelle 100 %**. Points à contrôler (fichiers 11, 14 ; AT08, AT20,
   AT21, AT28, AT37) :
   - aucun total, aucune cellule, aucun champ coupé ; marges latérales de 14 mm respectées ;
   - accents, « œ », « Œ », apostrophe typographique, guillemets « », signe « ° », « × » et « € » lisibles ;
   - montants groupés par espaces insécables (« 80 000 FCFA » jamais coupé en fin de ligne), signes des
     valeurs optiques (+ et −), zéro visible (« 0,00 »), valeurs non mesurées en tiret (« — ») ;
   - tableau de lignes : en-tête répété à chaque page, aucune ligne coupée entre deux pages, le bloc de
     totaux jamais seul sur une page (facture longue, 48 lignes) ;
   - filigrane BROUILLON / DUPLICATA / DONNÉES DE TEST lisible en noir et blanc sans gêner la lecture ;
   - bandeau « DOCUMENT DE TEST » et emplacements « à renseigner » (adresse, identifiant fiscal, logo,
     mentions) présents tant que les mentions réelles ne sont pas validées ;
   - ticket 80 mm : une seule bande continue, texte lisible sur l'imprimante thermique réelle (Q02) ;
   - aucun antécédent, symptôme ni réfraction sur une pièce financière ; aucun montant sur un document
     clinique ; aucun « payé », « soldé », « acquitté », « gratuit ».

3. Si le rendu est conforme, figer les références (une fois, après la revue) :

   ```text
   $env:EEO_DOCUMENT_GOLDEN = 'update'; npx vitest run tests/frontend/documents/golden
   ```

   Cela écrit `tests/fixtures/document-snapshots/<document>.txt` : texte de mise en page, nombre de
   pages et empreinte SHA-256 du PDF. Ces fichiers sont à valider en revue puis à versionner.

## Exécution ordinaire

Sans variable, le test rend les documents et vérifie qu'ils tiennent sur au moins une page ; il compare
chacun à son fichier de référence **s'il existe**. Un document sans référence est « ignoré » (skipped) :
rien n'est prétendu vérifié.

## Règle d'or : un modèle publié ne se modifie pas

Quand un fichier de référence diffère, le rendu d'un modèle publié (`TEST-1`) a changé. Si la cause est
voulue (nouvelle mention, correction de mise en page), **ajouter une nouvelle version de modèle**
(`documents/templates/registry.ts`, `contracts/compatibility.json`) et conserver l'ancienne pour les
pièces en attente de synchronisation (contrat 23). N'écraser les références qu'après avoir compris
l'écart ; une mise à jour de jsPDF peut aussi changer les octets : dans ce cas contrôler visuellement
puis mettre à jour.

## Revue du 2026-11-09 (19 documents, 24 pages)

Faite par l'agent de développement sur les PDF rendus (`EEO_DOCUMENT_GOLDEN=render`), page par page, puis références
figées (`EEO_DOCUMENT_GOLDEN=update`, 19 fichiers) ; rejeu ordinaire : 20 tests passés, 1 ignoré (le mode `update`).
**Ce n'est ni la revue par une personne du cabinet ni l'impression réelle**, qui restent à faire (voir « Non fait »).

Contrôles automatiques sur le texte de mise en page, sans constat : aucun « payé », « soldé », « acquitté » ni
« gratuit » ; aucun montant groupé par des espaces ordinaires (un montant ne se coupe pas en fin de ligne) ; chaque
document porte « DOCUMENT DE TEST », « BROUILLON » ou « DUPLICATA » ; aucun document ne mêle vocabulaire clinique et
vocabulaire financier.

Contrôles visuels, conformes : aucune cellule ni aucun total coupé, marges respectées ; accents, « œ » et « Œ »,
apostrophes typographiques et « ° » lisibles ; zéro visible (« 0,00 »), valeurs non mesurées en tiret (« — »), signes
+ et - des valeurs optiques ; filigranes BROUILLON, DUPLICATA et DONNÉES DE TEST en gris clair, lisibles sans gêner la
lecture ; bandeau « DOCUMENT DE TEST » et emplacements « à renseigner » présents ; facture longue (48 lignes, 5 pages) :
en-tête du tableau répété à chaque page, aucune ligne coupée, bloc de totaux précédé de lignes sur la dernière page ;
ticket 80 mm en une seule bande ; aucune donnée clinique sur une pièce financière, aucun montant sur un document
clinique.

Observations sans gravité, NON corrigées (un modèle publié ne se modifie pas : une correction demande une nouvelle
version de modèle, à décider) :

1. « 2 Paire » : l'unité n'est pas mise au pluriel quand la quantité dépasse 1 (facture longue).
2. Fiche de consultation : le bloc des distances pupillaires se lit « DP totale, DP OG, DP OD » (l'œil gauche avant le
   droit), chaque valeur restant étiquetée.
3. Fiche de consultation : le tableau de la prescription optique est coupé entre la ligne OD (fin de la page 1) et la
   ligne OG (page 2), avec l'en-tête répété.

Non fait : impression A4 noir et blanc à l'échelle 100 % ; lisibilité du ticket 80 mm sur l'imprimante thermique réelle
(Q02) ; revue par une personne du cabinet.
