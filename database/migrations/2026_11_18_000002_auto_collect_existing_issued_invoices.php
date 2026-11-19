<?php

use App\Domain\Billing\ExistingInvoiceAutoCollector;
use App\Support\Schema\BaselineInstaller;
use Illuminate\Database\Migrations\Migration;

/**
 * Régularise les factures valides (`ISSUED`, `NATIVE`) déjà émises sans encaissement afin qu'elles figurent en
 * espèces dans la caisse et son journal chronologique à leur heure exacte `issued_at`. Sans effet sur une base
 * neuve vide ni sur le schéma SQL.
 */
return new class extends Migration
{
    public function up(): void
    {
        app(ExistingInvoiceAutoCollector::class)->collectAll();
    }

    public function down(): void
    {
        BaselineInstaller::refuseRollback('auto_collect_existing_issued_invoices');
    }
};
