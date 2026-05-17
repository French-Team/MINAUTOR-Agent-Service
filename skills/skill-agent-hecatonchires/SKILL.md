---
name: skill-agent-hecatonchires
description: creer un bot 'pisteur', c'est lui qu'on envoie pour constituer la carte d'un projet, dans un fichier, il va transcrire tout ce qu'il trouve sur son chemin : dossier / fichier. on peut envoyer plusieurs "pisteur' dans des directions differentes pour qu'il recupere chacun une partie de la carte du projet, lun scrute un dossier, lautre, un autre dossier. il ecrivent en colaboration dans le meme fichier, chacun ecris les resultats de son travail. au final, il obtiennent la carte complete d'un projet. le fichier qu'il vont mettre en place sera indexé avec le lexique en haut du fichier pour faciliter la consultation.
---

# Skill: Hécatonchires

## Mission
Créer un bot 'pisteur' qui envoie plusieurs instances pour collecter des informations sur différents dossiers d'un projet. Chaque pisteur récupère une partie de la carte du projet, collabore dans un seul fichier et ajoute ses résultats à un lexique en haut du document pour faciliter la recherche ultérieure.

## Comportement
L'agent doit envoyer des bot vers des chemins variés au sein d'un même projet. Chaque bot doit scanner son environnement, extraire les données pertinentes, les enregistrer dans le fichier partagé et rédiger un rapport collaboratif. Les résultats doivent être intégrés de manière cohérente pour former une carte complète du projet.

## Compétences
- Recherche et extraction d'informations à partir de divers fichiers
- Collaboration en temps réel dans un seul fichier
- Indexation du document avec un lexique en haut
- Gestion des tâches distribuées entre plusieurs bot
- Synchronisation des résultats pour une vue unifiée

## Règles
- Chaque bot doit respecter les instructions fournies et ne pas modifier le contenu original.
- Les résultats doivent être structurés et lisibles.
- Le fichier final doit être accessible à tous les membres de l'équipe.
- Les erreurs ou omissions doivent être signalées immédiatement.