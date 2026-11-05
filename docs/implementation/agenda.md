# Agenda interne (S01) et suivis / tâches de contact internes (S02)

État au 2026-10-23 : **codé, non exécuté** (vérification transversale de fin de lot à venir). EN LIGNE seulement :
un rendez-vous pris hors ligne (proposition `PENDING_CONFIRMATION`) viendra avec O05. Module `agenda` (fermé par
défaut, `EEO_ENABLED_MODULES`). Aucun SMS ni WhatsApp réel : L0 calcule des tâches internes, L2 activera les envois.

## Serveur

| Élément | Fichiers |
| --- | --- |
| Disponibilités | `app/Domain/Scheduling/AvailabilityService.php` (créneaux hebdomadaires en heure locale, fermetures et ouvertures exceptionnelles, indisponibilités, rendez-vous qui occupent : `PENDING_CONFIRMATION`, `CONFIRMED`, `ARRIVED`, `COMPLETED`) |
| Contrôle recommandé | `app/Domain/Scheduling/FollowUpCalculator.php` (départ choisi + délai au calendrier civil, rappel avant ; jumeau `resources/frontend/domain/scheduling/followUp.ts`) |
| Tâches internes | `app/Domain/Communication/ContactTasks.php` (unicité `dedupe_key` par source et échéance ; ancienne programmation `CANCELLED`, jamais supprimée) |
| Lectures | `app/Domain/Scheduling/AgendaReader.php`, `app/Http/Resources/SchedulingPresenter.php` |
| Commandes | `app/Domain/Scheduling/SchedulingCommands.php`, `Handlers/*`, `app/Domain/Communication/Handlers/RecordContactAttemptHandler.php` |
| Contrôleurs | `AgendaController`, `AppointmentController`, `FollowUpController`, `ContactTaskController` |
| Démonstration | `php artisan eeo:demo:agenda` (salle, horaires, prestations et deux rappels internes FICTIFS ; refusé en production) |

### Routes (module `agenda`)

| Route | Droit | Commande |
| --- | --- | --- |
| `GET /agenda/configuration` | `agenda.read` | — |
| `GET /agenda/slots?date&resource_id&service_id` | `agenda.read` | — |
| `POST /agenda/resources`, `PATCH /agenda/resources/{id}` | `users.manage` | `SaveSchedulingResource` |
| `POST /agenda/resources/{id}/opening-hours` | `users.manage` | `ReplaceOpeningHours` |
| `POST /agenda/resources/{id}/exceptions` | `users.manage` | `AddResourceException` |
| `POST /agenda/services`, `PATCH /agenda/services/{id}` | `users.manage` | `SaveAppointmentService` |
| `GET /appointments?from&to[&resource_id&patient_id]` | `agenda.read` | — |
| `POST /appointments` | `agenda.write` | `CreateAppointment` (catalogue F06) |
| `POST /appointments/{id}/reschedule` · `/cancel` · `/no-show` | `agenda.write` | `RescheduleAppointment` · `CancelAppointment` · `MarkAppointmentNoShow` |
| `GET /follow-ups?from&to` ou `?consultation_id` | `agenda.read` | — |
| `POST /follow-ups` | `follow_up.write` (+ `clinical.read` vérifié par la commande) | `CreateFollowUp` (catalogue F06) |
| `POST /follow-ups/{id}/cancel` | `follow_up.write` (+ `clinical.read` vérifié par la commande) | `CancelFollowUp` (en ligne seulement) : statut `CANCELLED`, motif obligatoire (audit `follow_up.cancelled`), version attendue ; un contrôle `ACTIVE` seulement (programmé par un rendez-vous : annuler d'abord le rendez-vous ; annulé ou clos : 409) ; les tâches de rappel ouvertes sont closes ; le contrôle disparaît des « patients à revoir » mais reste lisible dans sa consultation |
| `GET /contact-tasks?due_date` | `agenda.read` | — |
| `POST /contact-tasks/{id}/attempts` | `agenda.write` | `RecordContactAttempt` (catalogue F06) |

Verrous (ordre unique, `LockRank`) : contrôle recommandé 48, rendez-vous 49, tâche de contact 51, ressource 52,
prestation 53, après le dossier patient (45), la visite (46) et la consultation (47). Deux réservations concurrentes
du même créneau sont sérialisées par le verrou exclusif du cabinet : la seconde reçoit 409 `SLOT_UNAVAILABLE`
(`tests/Concurrency/AgendaConcurrencyTest.php`).

### Règles

- Un rendez-vous est `CONFIRMED` à la réponse du serveur ; il désigne un patient (prospects : plus tard). Déplacement,
  annulation (motif 3–1000 caractères) et absence (après l'heure) exigent la version et un statut encore modifiable.
- La programmation précédente d'un rendez-vous déplacé reste dans l'audit (`appointment.rescheduled` : avant / après).
- Arrivée depuis l'agenda : `RegisterVisit` avec `appointment_id` passe le rendez-vous `ARRIVED` dans la même
  transaction ; une seconde arrivée du même rendez-vous est refusée.
- Une fermeture exceptionnelle qui couvrirait des rendez-vous existants est refusée (409) : on les déplace d'abord.
- Contrôle recommandé : origine choisie (consultation = sa date effective au fuseau du cabinet ; début ou fin de
  traitement = date du professionnel ; manuelle = motif obligatoire), date calculée recalculée par le serveur (422 si
  elle diffère), aucune décision médicale automatique. Programmé par un rendez-vous (`follow_up_id`) : `SCHEDULED`,
  tâches ouvertes `BOOKED` ; le rendez-vous annulé ou manqué le remet `ACTIVE`.
- Cloisonnement : `reason`, `notes` et `manual_reason` d'un contrôle valent null sans `clinical.read` ; l'audit ne
  porte que dates, origine et canal.
- Tâches : rappel d'un contrôle à minuit du cabinet le jour du rappel ; rappels de rendez-vous selon les politiques
  actives « APPOINTMENT » (`reminder_policies`, ex. veille 18 h, 2 h avant), seulement si l'échéance n'est pas passée.
  Liste du jour = ouvertes dues au plus tard ce jour (retards compris, report ultérieur exclu) + traitées ce jour.

## Écrans

`resources/frontend/pages/agenda/{AgendaPage,NewAppointmentPage,AppointmentCard,AgendaSettingsPage}.vue`,
`pages/agenda/settings/*`, `pages/follow-ups/{FollowUpsPage,ContactTaskCard,FollowUpPanel}.vue`, domaine
`domain/agenda/agenda.ts`, service `app/services/agenda.ts`, heure locale `pages/agenda/localTime.ts`. Routes
`/agenda`, `/agenda/nouveau`, `/agenda/configuration`, `/suivis` ; panneau « Contrôle recommandé » sous la
consultation ; arrivée liée par `?rendez-vous=` sur `/aujourdhui/arrivee`. Aide intégrée : sections « Agenda et
rendez-vous » et « Patients à rappeler ». Statistiques R02 : `appointments` et `follow_ups_due` comptés quand le module
agenda est ouvert.

## Hypothèses à faire confirmer par la cliente

- Configuration de l'agenda réservée à la gérante via `users.manage` (aucun droit dédié au référentiel).
- Rendez-vous occupant un créneau : à confirmer, confirmé, arrivé, terminé ; annulé et absent le libèrent.
- Rappels de rendez-vous : politiques de la proposition commerciale (veille 18 h, deux heures avant) créées pour la
  démonstration seulement ; leur configuration à l'écran n'existe pas encore (lot L2 avec les envois).
- Heure de la tâche d'un rappel de contrôle : minuit du jour de rappel ; durée maximale d'un rendez-vous 480 minutes.
- Pas de l'agenda par ressource (15 minutes en démonstration) ; horaires et durées de démonstration fictifs.

## À regarder en vérification

PHPUnit `tests/Feature/Scheduling/*`, `tests/Concurrency/AgendaConcurrencyTest.php`, `tests/Unit/Scheduling/*` ;
`OpenApiRoutesTest` (nouvelles routes et `x-permission`), `ContractFixturesTest` (ressources Appointment, FollowUpPlan,
ContactTask modifiées : fixtures `create-appointment.*`, `create-follow-up.*`, `record-contact-attempt.*` à revoir),
`CentralPathGuardTest` (nouvelles commandes), `LockRank` (nouveaux rangs) ; Vitest `tests/frontend/{domain/agenda,
agenda/agenda-pages,help/help-guide}.test.ts`, `bootstrap.test.ts` (4 routes de plus), `shell/navigation.test.ts`
(entrées Agenda, Rendez-vous, « Patients à rappeler » livrées) ; Playwright `tests/e2e/agenda.spec.ts` et les listes
exactes de `shell.spec.ts` (accueil et menu avec le module agenda ouvert).
