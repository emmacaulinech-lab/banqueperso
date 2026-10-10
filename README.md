# Ma Banque

Application personnelle de suivi bancaire, avec connexion Firebase existante. Le site reste statique : `index.html`, `finance.js`, `sunset.js` et `sunset.css` doivent être déployés ensemble. Aucun changement des règles Firebase ni nouvelle clé n'est nécessaire.

## Fonctionnement

- Accueil en dégradé rose, orange et jaune ; navigation adaptée au téléphone et à l'ordinateur.
- Solde vérifié à une date : les imports anciens ne déplacent pas ce repère. Les opérations futures sont exclues du solde actuel.
- Import LCL : chaque ligne est conservée, y compris les paiements identiques. Contrôle obligatoire entre solde initial, opérations et solde final ; comparaison du nombre d'occurrences avec l'historique avant import. Date d'opération utilisée, pas date de valeur.
- Opérations : recherche par libellé ou montant, période et catégorie ; modification dans un formulaire ; annulation d'une suppression pendant 30 secondes ; mémorisation des catégories choisies.
- Virements internes : affectent le compte courant, mais sont exclus des revenus et dépenses analytiques. Leur classement reste un choix explicite.
- Budget : limites facultatives, comparaison au mois précédent, report des surplus positifs à partir d'une période choisie. Modifier la limite recalcule les reports depuis cette période.
- Calendrier : mouvements enregistrés, prévisions détectées après deux occurrences sur des dates distinctes, ajout manuel, confirmation, modification ou retrait. Une échéance peut être ignorée seulement pour cette occurrence.
- Prévisions : les paiements réguliers sont exclus de la moyenne des dépenses variables. L'estimation de fin de mois demande un historique suffisant et reste explicitement une estimation.
- Objectifs d'épargne et remboursements attendus : suivi indicatif, sans création de virements ou de rentrées automatiques.
- Masquage des montants et export JSON des données.
- Sauvegardes atomiques avec révision : en cas de modification sur un autre appareil, recharger avant de réessayer. Une erreur de chargement n'ouvre pas une base vide ; une erreur de sauvegarde annule la mutation locale.

## Mise à jour d'un historique existant

1. Exporter une sauvegarde depuis l'application.
2. Réimporter les relevés concernés. Vérifier que le contrôle du solde est correct et que seules les occurrences manquantes sont cochées. Les opérations déjà présentes restent décochées.
3. Si une opération existante a été modifiée, comparer cette opération au relevé avant de réimporter : une modification de date, libellé, montant ou type peut empêcher sa reconnaissance.
4. Vérifier le solde bancaire actuel avec une date de référence. Le solde comptabilisé à cette date doit inclure les opérations du jour déjà présentes. Les opérations encore en attente doivent être suivies séparément.

Les anciennes données ne sont jamais réparées automatiquement. Les lignes importées peuvent être corrigées dans l'aperçu. Un écart bloque l'import PDF. L'import d'image reste disponible mais ne peut pas vérifier le solde final du relevé.

## Vérification

Avec Node.js 18 ou plus récent :

```sh
npm install
npm test
```

Les tests utilisent exclusivement des données synthétiques. Ils couvrent les centimes, les dates, les paiements identiques, les prévisions séparées, les budgets reportés, les formulaires, la navigation, l'annulation, les échecs de sauvegarde, les conflits entre appareils, les réimports et les contrôles de solde.

À vérifier avant mise en ligne : rendu sur téléphone et ordinateur, connexion au compte Firebase réel et permission existante d'écriture sur le document utilisateur. Les tests simulent Firebase ; ils ne prouvent pas les règles ou la disponibilité du service réel.
