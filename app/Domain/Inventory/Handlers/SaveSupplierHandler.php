<?php

namespace App\Domain\Inventory\Handlers;

use App\Application\Command;
use App\Application\CommandHandler;
use App\Application\CommandOutcome;
use App\Application\Effects\AuditEntry;
use App\Application\Locking\TransactionLocks;
use App\Domain\Billing\Rules\FieldErrors;
use App\Domain\Shared\BusinessError;
use App\Domain\Shared\CommandContext;
use App\Domain\Shared\RuleViolation;
use App\Domain\Shared\Ulid;
use App\Domain\Shared\ValueObjects\Text;
use Illuminate\Support\Facades\DB;

/**
 * Fournisseur ou laboratoire (L1D01, EE026) : création (`entityId` nul) ou modification complète. Droit
 * `stock.receive`, EN LIGNE seulement. Le code (`reference`) est unique par cabinet (comparaison de la base : casse et
 * accents ignorés). Un fournisseur ne se supprime jamais : il se désactive (`active` faux) et reste lisible sur ses
 * réceptions passées. L'audit consigne le code et les indicateurs, pas les coordonnées.
 */
final class SaveSupplierHandler implements CommandHandler
{
    public const COMMAND = 'SaveSupplier';

    public function permissions(): array
    {
        return ['stock.receive'];
    }

    public function handle(Command $command, CommandContext $context, TransactionLocks $locks, ?string $idempotencyId): CommandOutcome
    {
        $payload = $command->payload;
        $errors = new FieldErrors;

        $name = Text::trim((string) ($payload['name'] ?? ''));
        if (mb_strlen($name, 'UTF-8') < 2) {
            $errors->add('name', 'Le nom du fournisseur compte au moins 2 caractères.');
        }
        $reference = Text::trim((string) ($payload['reference'] ?? ''));
        if ($reference === '') {
            $errors->add('reference', 'Le code du fournisseur est obligatoire.');
        }
        $phone = $email = $address = null;
        try {
            $phone = Text::optional(is_string($payload['phone'] ?? null) ? $payload['phone'] : null, 32, 'phone');
            $email = Text::optional(is_string($payload['email'] ?? null) ? $payload['email'] : null, 254, 'email');
            $address = Text::optional(is_string($payload['address'] ?? null) ? $payload['address'] : null, 2000, 'address');
        } catch (RuleViolation $violation) {
            $errors->addViolation('', $violation);
        }
        if ($email !== null && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $errors->add('email', 'Adresse e-mail invalide.');
        }

        $id = $command->entityId;
        if ($id !== null && ! DB::table('suppliers')->where('clinic_id', $context->clinicId)->where('id', $id)->exists()) {
            throw BusinessError::notFound('Fournisseur introuvable dans ce cabinet.');
        }
        $clash = DB::table('suppliers')->where('clinic_id', $context->clinicId)->where('reference', $reference);
        if ($id !== null) {
            $clash->where('id', '<>', $id);
        }
        if ($reference !== '' && $clash->exists()) {
            $errors->add('reference', 'Ce code est déjà utilisé par un autre fournisseur.');
        }
        $errors->throwIfAny();

        $now = $context->now->utc()->format('Y-m-d H:i:s.u');
        $columns = [
            'name' => $name,
            'reference' => $reference,
            'phone' => $phone,
            'email' => $email,
            'address' => $address,
            'is_optical_lab' => (bool) ($payload['is_optical_lab'] ?? false),
            'active' => (bool) ($payload['active'] ?? true),
            'updated_at' => $now,
        ];
        if ($id === null) {
            $id = Ulid::generate();
            DB::table('suppliers')->insert($columns + ['id' => $id, 'clinic_id' => $context->clinicId, 'created_at' => $now]);
        } else {
            DB::table('suppliers')->where('clinic_id', $context->clinicId)->where('id', $id)->update($columns);
        }

        return new CommandOutcome(
            result: ['supplier_id' => $id],
            resultType: 'suppliers',
            resultId: $id,
            audit: [new AuditEntry($command->entityId === null ? 'stock.supplier_created' : 'stock.supplier_updated', 'suppliers', $id, null, [
                'reference' => $reference,
                'is_optical_lab' => $columns['is_optical_lab'],
                'active' => $columns['active'],
            ])],
        );
    }
}
