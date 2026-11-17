<?php

namespace App\Application\Locking;

/**
 * Rang de chaque verrou dans l'ordre unique de L0 (contrat 23, « Chemin transactionnel central ») :
 * cabinet → appareil si journal → idempotence → séquences/plages → dossier patient → visite → consultation →
 * propriété de facture → facture → session de caisse → positions, lots et quotas par identifiant trié →
 * approbation. Les comptes du personnel (`users`) se verrouillent juste après le cabinet (décision F05 :
 * cabinet → compte). Le dossier patient (45), la visite (46) et la consultation (47) s'ajoutent à l'ordre du
 * contrat 23 (écart consigné au journal) : une écriture clinique part du parent vers l'enfant, puis vers la
 * facture qu'elle déclenche. L'agenda (S01, S02) ajoute le contrôle recommandé (48), le rendez-vous (49), la tâche
 * de contact (51), la ressource (52) et la prestation (53) de l'agenda : un rendez-vous pris depuis un suivi verrouille
 * le suivi puis le rendez-vous ; une tentative de contact verrouille le rendez-vous qu'elle désigne puis la tâche.
 *
 * Toutes les actions, ainsi que les opérations de préparation et de transfert de poste, verrouillent dans
 * cet ordre ; aucun contrôleur ne verrouille en sens inverse. Deux transactions qui prennent leurs lignes dans
 * le même ordre ne s'attendent pas en cycle ; les verrous d'intervalle d'InnoDB (insertion d'une clé absente)
 * peuvent encore produire un interblocage entre deux CABINETS, rejoué en entier par TransactionRunner. Les rangs
 * sont espacés pour qu'une insertion future ne renumérote pas l'existant.
 */
enum LockRank: int
{
    case Clinic = 10;
    case Account = 15;
    case Device = 20;
    case Idempotency = 30;
    case WebhookInbox = 35;
    case IntegrationAccount = 36;
    case CalendarSyncState = 37;
    case OutboxEvent = 38;
    case KnowledgeEntry = 39;
    case Sequence = 40;
    case CrmLead = 41;
    case CrmConversation = 42;
    case PublicBookingRequest = 43;
    case ProspectContact = 44;
    case Patient = 45;
    case Visit = 46;
    case Consultation = 47;
    case FollowUpPlan = 48;
    case Appointment = 49;
    case InvoiceOwner = 50;
    case ContactTask = 51;
    case SchedulingResource = 52;
    case AppointmentService = 53;
    case ReminderPolicy = 54;
    // Devis (L1D07) : après le dossier patient qu'il vise, avant la facture que sa conversion crée.
    case Quote = 55;
    case Invoice = 60;
    case CommunicationConsent = 61;
    case Campaign = 62;
    case CampaignRecipient = 63;
    case MessageTemplate = 64;
    case WorkshopOrder = 65;
    case MessageAttempt = 67;
    case CashSession = 70;
    case PaymentReconciliation = 75;
    case StockPosition = 80;
    case StockLot = 81;
    case StockQuota = 82;
    case CatalogPublication = 85;
    case PublicContent = 86;
    case Approval = 90;

    public function label(): string
    {
        return match ($this) {
            self::Clinic => 'cabinet',
            self::Account => 'compte',
            self::Device => 'appareil',
            self::Idempotency => 'idempotence',
            self::WebhookInbox => 'boîte de réception webhook',
            self::IntegrationAccount => 'compte d’intégration',
            self::CalendarSyncState => 'état de synchronisation agenda',
            self::OutboxEvent => 'événement d’outbox',
            self::KnowledgeEntry => 'fiche de connaissances',
            self::Sequence => 'séquence de numéros',
            self::CrmLead => 'piste CRM',
            self::CrmConversation => 'conversation CRM',
            self::PublicBookingRequest => 'demande de rendez-vous publique',
            self::ProspectContact => 'contact prospect',
            self::Patient => 'dossier patient',
            self::Visit => 'visite',
            self::Consultation => 'consultation',
            self::FollowUpPlan => 'contrôle recommandé',
            self::Appointment => 'rendez-vous',
            self::InvoiceOwner => 'propriété de facture',
            self::ContactTask => 'tâche de contact',
            self::SchedulingResource => "ressource de l'agenda",
            self::AppointmentService => "prestation de l'agenda",
            self::ReminderPolicy => 'politique de rappel',
            self::Quote => 'devis',
            self::Invoice => 'facture',
            self::CommunicationConsent => 'consentement de communication',
            self::Campaign => 'campagne de diffusion',
            self::CampaignRecipient => 'destinataire de campagne',
            self::MessageTemplate => 'modèle de message',
            self::WorkshopOrder => 'commande atelier',
            self::MessageAttempt => 'tentative d’envoi',
            self::CashSession => 'session de caisse',
            self::PaymentReconciliation => 'rapprochement de paiement',
            self::StockPosition => 'position de stock',
            self::StockLot => 'lot de stock',
            self::StockQuota => 'quota de poste',
            self::CatalogPublication => 'publication catalogue',
            self::PublicContent => 'contenu public',
            self::Approval => 'approbation',
        };
    }
}
