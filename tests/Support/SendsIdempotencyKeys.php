<?php

namespace Tests\Support;

use App\Domain\Shared\Ulid;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Les écritures par le chemin central exigent un en-tête `Idempotency-Key` : chaque requête d'écriture d'un test qui
 * emploie ce trait en reçoit une NEUVE, sauf si le test en a posé une lui-même (`withHeader`, ou en paramètre de la
 * requête) : un rejeu volontaire garde sa clé.
 */
trait SendsIdempotencyKeys
{
    /**
     * @param  string  $method
     * @param  string  $uri
     * @param  array<string, mixed>  $data
     * @param  array<string, string>  $headers
     * @param  int  $options
     * @return TestResponse<Response>
     */
    public function json($method, $uri, array $data = [], array $headers = [], $options = 0)
    {
        $writes = in_array(strtoupper((string) $method), ['POST', 'PATCH', 'PUT', 'DELETE'], true);
        if ($writes && ! array_key_exists('Idempotency-Key', $headers) && ! array_key_exists('Idempotency-Key', $this->defaultHeaders)) {
            $headers['Idempotency-Key'] = Ulid::generate();
        }

        return parent::json($method, $uri, $data, $headers, $options);
    }
}
