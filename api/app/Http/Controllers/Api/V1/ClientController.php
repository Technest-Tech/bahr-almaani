<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreClientRequest;
use App\Http\Resources\ClientResource;
use App\Models\Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ClientController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $clients = Client::query()
            ->withCount('projects')
            ->when($request->filled('q'), function ($query) use ($request): void {
                // Scout (Meilisearch): typo-tolerant search over name/phone/email/notes.
                $query->whereIn('clients.id', Client::search(
                    $request->string('q')->trim()->toString(),
                )->take(500)->keys());
            })
            ->when($request->filled('type'), fn ($query) => $query->where('type', $request->string('type')->toString()))
            ->orderByDesc('created_at')
            ->paginate(min($request->integer('per_page', 15), 100));

        return ClientResource::collection($clients);
    }

    public function show(Client $client): ClientResource
    {
        return ClientResource::make($client->loadCount('projects'));
    }

    public function store(StoreClientRequest $request): JsonResponse
    {
        $client = Client::create([
            ...$request->validated(),
            'created_by' => $request->user()->id,
        ]);

        return ClientResource::make($client)->response()->setStatusCode(201);
    }

    public function update(StoreClientRequest $request, Client $client): ClientResource
    {
        $client->update($request->validated());

        return ClientResource::make($client);
    }

    public function destroy(Client $client): JsonResponse
    {
        abort_if(
            $client->projects()->exists(),
            422,
            __('clients.has_projects'),
        );

        $client->delete();

        return response()->json(['message' => 'ok']);
    }
}
