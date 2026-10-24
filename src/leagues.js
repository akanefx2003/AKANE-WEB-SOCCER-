'use strict';

// Liste des compétitions affichées. `id` est l'identifiant ESPN.
// Pour en ajouter une : ajoute une ligne ici, rien d'autre à toucher.
// Une compétition sans données (hors saison, identifiant inconnu) s'affiche simplement vide.
const LEAGUES = [
  { id: 'fra.1', name: 'Ligue 1' },
  { id: 'eng.1', name: 'Premier League' },
  { id: 'esp.1', name: 'Liga' },
  { id: 'ita.1', name: 'Serie A' },
  { id: 'ger.1', name: 'Bundesliga' },
  { id: 'uefa.champions', name: 'Ligue des champions' },
  { id: 'uefa.europa', name: 'Ligue Europa' },
  { id: 'uefa.europa.conf', name: 'Ligue Conférence' },
  { id: 'caf.champions', name: 'Ligue des champions CAF' },
  { id: 'caf.confed', name: 'Coupe de la Confédération CAF' },
  { id: 'caf.nations', name: 'CAN' },
  { id: 'fifa.world', name: 'Coupe du monde' },
  { id: 'usa.1', name: 'MLS' },
  { id: 'por.1', name: 'Liga Portugal' },
  { id: 'ned.1', name: 'Eredivisie' },
  { id: 'tur.1', name: 'Süper Lig' },
  { id: 'bra.1', name: 'Brasileirão' },
  { id: 'arg.1', name: 'Liga argentine' },
  { id: 'mex.1', name: 'Liga MX' },
  { id: 'sau.1', name: 'Saudi Pro League' },
  { id: 'mar.1', name: 'Botola Pro' },
  { id: 'eng.2', name: 'Championship' },
  { id: 'fra.2', name: 'Ligue 2' },
  { id: 'conmebol.libertadores', name: 'Copa Libertadores' },
  { id: 'eng.fa', name: 'FA Cup' },
  { id: 'esp.copa_del_rey', name: 'Coupe du Roi' },
  { id: 'ita.coppa_italia', name: 'Coupe d\'Italie' },
  { id: 'ger.dfb_pokal', name: 'Coupe d\'Allemagne' },
  { id: 'fra.coupe_de_france', name: 'Coupe de France' }
];

const byId = (id) => LEAGUES.find((l) => l.id === id);

module.exports = { LEAGUES, byId };
