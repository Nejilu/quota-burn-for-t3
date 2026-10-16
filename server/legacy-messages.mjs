// Display old system messages in English without changing stored history or user content.
const messages=[
  [
    "Respecte AGENTS.md et les permissions choisies. Termine chaque étape par un bref bilan et la prochaine action utile. Si l’objectif est accompli, termine par [QP_COMPLETE]. Si une intervention humaine est nécessaire ou si aucune progression utile n’est possible, termine par [QP_BLOCKED] et explique pourquoi. Ne crée pas de travail artificiel pour consommer un quota.",
    "Follow AGENTS.md and the selected permissions. End each step with a short summary and the next useful action. If the goal is complete, end with [QP_COMPLETE]. If human input is needed or no useful progress is possible, end with [QP_BLOCKED] and explain why. Do not invent work just to consume quota."
  ],
  [
    "Choisis la prochaine étape utile, réalise-la et vérifie le résultat. Évite les répétitions et respecte les limites du projet.",
    "Choose the next useful step, complete it, and verify the result. Avoid repetition and respect the project limits."
  ],
  [
    "Un reset est incertain. Reprenez cette même opération avant d’en créer une autre.",
    "A reset result is uncertain. Retry the same operation before creating another."
  ],
  [
    "Envoi incertain : vérification de la conversation requise avant toute relance.",
    "Submission uncertain: check the conversation before retrying."
  ],
  [
    "Aucun objectif admissible : créez un projet ou reprenez un projet en pause.",
    "No eligible goals: create a goal or resume a paused one."
  ],
  [
    "Arrêt global demandé ; seules les conversations pilotées sont interrompues.",
    "Global stop requested; only managed conversations are interrupted."
  ],
  [
    "Mettez le projet en pause et attendez la fin du tour avant de le modifier.",
    "Pause the project and wait for the current turn to finish before editing it."
  ],
  [
    "Arrêtez le tour en cours avant de modifier ou supprimer cette campagne.",
    "Stop the current turn before editing or deleting this campaign."
  ],
  [
    "Dupliquez la campagne terminée pour recommencer avec un nouveau budget.",
    "Duplicate the completed campaign to start again with a new budget."
  ],
  [
    "Il faut utiliser cette fenêtre pour atteindre la cible avant le reset.",
    "This window is needed to reach the target before the reset."
  ],
  [
    "Une conversation T3 utilise ce compte ; priorité au travail manuel.",
    "A T3 conversation is using this account; manual work takes priority."
  ],
  [
    "La conversation ne correspond pas au projet ou au compte choisi.",
    "The conversation does not match the selected project or account."
  ],
  [
    "Résultat du reset incertain : réessayer cette même intention.",
    "Reset result uncertain: retry the same intent."
  ],
  [
    "Commande locale T3 indisponible. Vérifiez que T3 est démarré.",
    "Local T3 command unavailable. Make sure T3 is running."
  ],
  [
    "Les fenêtres futures permettent encore d’atteindre la cible.",
    "Future windows still provide enough capacity to reach the target."
  ],
  [
    "Redémarrage pendant un reset : reprendre la même intention.",
    "Restart during a reset: retry the same intent."
  ],
  [
    "Envoi non retrouvé ; abandon confirmé après lecture de T3.",
    "Submission not found; cancellation confirmed after checking T3."
  ],
  [
    "Commence par la prochaine étape concrète de cet objectif.",
    "Start with the next concrete step toward this goal."
  ],
  [
    "Conversation non retrouvée. Revérifiez avant de relancer.",
    "Conversation not found. Check again before retrying."
  ],
  [
    "Arrêtez le tour en cours avant de supprimer cet objectif.",
    "Stop the current turn before deleting this goal."
  ],
  [
    "Réserve de session atteinte ; attente du prochain reset.",
    "Session reserve reached; waiting for the next reset."
  ],
  [
    "Quota Burn fonctionne déjà pour cette base de données.",
    "Quota Burn is already running for this database."
  ],
  [
    "Un message humain a été ajouté depuis le dernier tour.",
    "A human message was added since the last turn."
  ],
  [
    "Relevé de quota périmé ; rafraîchissement nécessaire.",
    "Quota reading is stale; refresh required."
  ],
  [
    "Résolvez d’abord l’envoi incertain dans l’historique.",
    "Resolve the uncertain submission in the activity log first."
  ],
  [
    "Rechargez Quota Burn pour ouvrir une session locale.",
    "Reload Quota Burn to open a local session."
  ],
  [
    "Version T3 non validée : 0.0.45 / protocole 1 requis.",
    "Unsupported T3 version: 0.0.45 / protocol 1 required."
  ],
  [
    "La conversation travaille ; aucune relance permise.",
    "The conversation is running; retry is not allowed."
  ],
  [
    "Impossible de démarrer le lecteur de crédits Codex.",
    "Could not start the Codex credit reader."
  ],
  [
    "Pause demandée ; le tour courant peut se terminer.",
    "Pause requested; the current turn may finish."
  ],
  [
    "Campagne active : utiliser la fenêtre disponible.",
    "Active campaign: use the available window."
  ],
  [
    "Compte T3 introuvable. Rafraîchissez les comptes.",
    "T3 account not found. Refresh your accounts."
  ],
  [
    "Quotas indisponibles depuis plus de cinq minutes.",
    "Quotas have been unavailable for more than five minutes."
  ],
  [
    "Trois bilans identiques : progression à vérifier.",
    "Three identical summaries: check progress."
  ],
  [
    "Quittez la pause globale avant de lancer un tour.",
    "Leave global pause before starting a turn."
  ],
  [
    "T3 n’a pas pu confirmer les quotas de ce compte.",
    "T3 could not confirm the quotas for this account."
  ],
  [
    "Session de commande invalide. Rechargez la page.",
    "Invalid command session. Reload the page."
  ],
  [
    "Reset hebdomadaire détecté : campagne terminée.",
    "Weekly reset detected: campaign completed."
  ],
  [
    "Activez l’exécution avant d’appliquer un reset.",
    "Enable the pilot before applying a reset."
  ],
  [
    "Les deux fenêtres de quota sont nécessaires.",
    "Both quota windows are required."
  ],
  [
    "T3 travaille déjà sur ce compte ou ce dépôt.",
    "T3 is already working on this account or repository."
  ],
  [
    "Reconnectez T3 avant de modifier un projet.",
    "Reconnect T3 before editing a project."
  ],
  [
    "Limite de tours ou test ponctuel terminé.",
    "Turn limit reached or single-turn test completed."
  ],
  [
    "L’agent attend une intervention humaine.",
    "The agent is waiting for human input."
  ],
  [
    "Quotas et projets synchronisés avec T3.",
    "Quotas and projects synced with T3."
  ],
  [
    "Contrôle rendu à l’utilisateur dans T3.",
    "Control handed back to the user in T3."
  ],
  [
    "Plafond cumulé de la campagne atteint.",
    "Campaign cumulative cap reached."
  ],
  [
    "Compte non autorisé pour cet objectif.",
    "Account not allowed for this goal."
  ],
  [
    "Le compte de la conversation a changé.",
    "The conversation account has changed."
  ],
  [
    "Automatique désactivé pour ce compte.",
    "Automatic scheduling is disabled for this account."
  ],
  [
    "Option de modèle non prise en charge.",
    "Unsupported model option."
  ],
  [
    "Cette conversation travaille déjà.",
    "This conversation is already running."
  ],
  [
    "Accès depuis un autre site refusé.",
    "Cross-site access rejected."
  ],
  [
    "Conversation occupée ou archivée.",
    "Conversation is busy or archived."
  ],
  [
    "Aucun envoi incertain à résoudre.",
    "No uncertain submission to resolve."
  ],
  [
    "Codex : délai de lecture dépassé.",
    "Codex: read timed out."
  ],
  [
    "Durée maximale du tour atteinte.",
    "Maximum turn duration reached."
  ],
  [
    "Limite de consommation atteinte.",
    "Usage limit reached."
  ],
  [
    "Ce crédit n’est plus disponible.",
    "This credit is no longer available."
  ],
  [
    "Une date de fin est nécessaire.",
    "An end date is required."
  ],
  [
    "Compte de campagne introuvable.",
    "Campaign account not found."
  ],
  [
    "Projet de campagne introuvable.",
    "Campaign project not found."
  ],
  [
    "Intention de reset introuvable.",
    "Reset intent not found."
  ],
  [
    "Choisissez un dossier existant.",
    "Choose an existing folder."
  ],
  [
    "Réponse Codex trop volumineuse.",
    "Codex response too large."
  ],
  [
    "Réserve hebdomadaire atteinte.",
    "Weekly reserve reached."
  ],
  [
    "Quota Burn — objectif durable",
    "Quota Burn — persistent goal"
  ],
  [
    "Reconnectez ce compte dans T3.",
    "Reconnect this account in T3."
  ],
  [
    "Un tour piloté est déjà actif.",
    "A managed turn is already active."
  ],
  [
    "Le lecteur Codex s’est arrêté.",
    "The Codex reader stopped."
  ],
  [
    "Compte à reconnecter dans T3.",
    "Reconnect this account in T3."
  ],
  [
    "Campagne arrêtée ou en pause.",
    "Campaign stopped or paused."
  ],
  [
    "Intervention humaine dans T3.",
    "Human intervention in T3."
  ],
  [
    "La fin doit suivre le début.",
    "The end must be after the start."
  ],
  [
    "Choisissez la date du reset.",
    "Choose the reset date."
  ],
  [
    "T3 : connexion interrompue.",
    "T3: connection interrupted."
  ],
  [
    "Codex a refusé l’opération",
    "Codex rejected the operation"
  ],
  [
    "Compte en pause manuelle.",
    "Account manually paused."
  ],
  [
    "Modèle indisponible pour ",
    "Model unavailable for "
  ],
  [
    "Le dernier tour a échoué.",
    "The last turn failed."
  ],
  [
    "Requête trop volumineuse.",
    "Request body too large."
  ],
  [
    "Tour interrompu dans T3.",
    "Turn interrupted in T3."
  ],
  [
    "Aucun bilan exploitable.",
    "No usable summary."
  ],
  [
    "Arrêt du projet demandé.",
    "Project stop requested."
  ],
  [
    "Plafond cumulé atteint.",
    "Cumulative cap reached."
  ],
  [
    "Campagne enregistrée : ",
    "Campaign saved: "
  ],
  [
    "Arrêt immédiat demandé.",
    "Immediate stop requested."
  ],
  [
    "T3 : réponse illisible.",
    "T3: unreadable response."
  ],
  [
    "Connexion Codex fermée.",
    "Codex connection closed."
  ],
  [
    "Projet T3 introuvable.",
    "T3 project not found."
  ],
  [
    "Nom et dossier requis.",
    "Name and folder required."
  ],
  [
    "T3 : opération refusée",
    "T3: operation rejected"
  ],
  [
    "T3 : connexion fermée.",
    "T3: connection closed."
  ],
  [
    "Automatique désactivé",
    "Automatic scheduling disabled"
  ],
  [
    "Date de fin atteinte.",
    "End date reached."
  ],
  [
    "Campagne introuvable.",
    "Campaign not found."
  ],
  [
    "Objectif introuvable.",
    "Goal not found."
  ],
  [
    "Réserve hebdomadaire",
    "Weekly reserve"
  ],
  [
    "Campagne programmée.",
    "Campaign scheduled."
  ],
  [
    "T3 : requête refusée",
    "T3: request rejected"
  ],
  [
    "Projet introuvable.",
    "Project not found."
  ],
  [
    "Compte introuvable.",
    "Account not found."
  ],
  [
    "Réserve de session",
    "Session reserve"
  ],
  [
    "Objectif accompli.",
    "Goal completed."
  ],
  [
    "Corps JSON requis.",
    "JSON body required."
  ],
  [
    "Hôte local requis.",
    "Local host required."
  ],
  [
    "Erreur inattendue.",
    "Unexpected error."
  ],
  [
    "T3 : délai dépassé",
    "T3: request timed out"
  ],
  [
    "Action inconnue.",
    "Unknown action."
  ],
  [
    "Origine refusée.",
    "Origin rejected."
  ],
  [
    "Méthode refusée.",
    "Method not allowed."
  ]
];
export function englishMessage(value){if(typeof value!=="string")return value;value=value.replaceAll('Quota Pilot','Quota Burn');for(const [old,text] of messages)value=value.replaceAll(old,text);return value.replace(/^Tour ([\w-]+) : /,"Turn $1: ").replace(/^Mode : /,"Mode: ").replace(/ : reprise\.$/,": resumed.");}

export function englishRecord(record){const view={...record};for(const key of ['reason','error','stopReason','message'])if(typeof view[key]==='string')view[key]=englishMessage(view[key]);return view;}
