<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreQuoteRequestRequest;
use App\Http\Resources\LanguageResource;
use App\Http\Resources\PublicQuoteRequestResource;
use App\Models\Language;
use App\Models\QuoteRequest;
use App\Models\User;
use App\Notifications\QuoteRequestReceivedNotification;
use App\Services\QuoteReferenceGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;

/**
 * The public website's half of M13 — unauthenticated, rate-limited, and the only
 * place in the API a request arrives without a user behind it.
 */
class PublicQuoteRequestController extends Controller
{
    /** The language list the public form offers. Same catalogue, no auth. */
    public function languages(): AnonymousResourceCollection
    {
        return LanguageResource::collection(
            Language::active()->orderBy('name_ar')->get()
        );
    }

    public function store(StoreQuoteRequestRequest $request, QuoteReferenceGenerator $references): JsonResponse
    {
        $validated = $request->validated();

        $quote = DB::transaction(function () use ($request, $validated, $references): QuoteRequest {
            $quote = QuoteRequest::create([
                ...collect($validated)->except('files')->all(),
                'reference' => $references->next(),
                'status' => QuoteRequest::STATUS_NEW,
                'ip_address' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 255),
            ]);

            foreach ($request->file('files', []) as $upload) {
                $quote->files()->create([
                    'original_name' => $upload->getClientOriginalName(),
                    'disk_path' => $upload->store("quote-requests/{$quote->id}", 'local'),
                    'mime_type' => $upload->getClientMimeType(),
                    'size_bytes' => $upload->getSize(),
                ]);
            }

            return $quote;
        });

        $this->notifyStaff($quote);

        return PublicQuoteRequestResource::make(
            $quote->load(['sourceLanguage', 'targetLanguage'])->loadCount('files')
        )
            ->additional(['message' => __('quotes.submitted', ['reference' => $quote->reference])])
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Status lookup by reference. Anyone holding the reference sees the quote —
     * that is the whole point — so the reference is random (see the generator) and
     * the route is throttled to make guessing pointless.
     */
    public function show(string $reference): PublicQuoteRequestResource
    {
        $quote = QuoteRequest::query()
            ->with(['sourceLanguage', 'targetLanguage', 'project:id,code'])
            ->withCount('files')
            ->where('reference', QuoteReferenceGenerator::normalize($reference))
            ->first();

        abort_if($quote === null, 404, __('quotes.not_found'));

        return PublicQuoteRequestResource::make($quote);
    }

    /** Everyone who can act on quotes gets the bell + (optionally) the mail. */
    private function notifyStaff(QuoteRequest $quote): void
    {
        $recipients = User::permission('quotes.manage')
            ->where('status', User::STATUS_ACTIVE)
            ->with('notificationPreferences')
            ->get();

        if ($recipients->isNotEmpty()) {
            Notification::send($recipients, new QuoteRequestReceivedNotification($quote));
        }
    }

    /** Attachment sizes/types the form should advertise, so the UI can't drift from the rules. */
    public function limits(): JsonResponse
    {
        return response()->json([
            'data' => [
                'max_files' => StoreQuoteRequestRequest::MAX_FILES,
                'max_file_kb' => StoreQuoteRequestRequest::MAX_FILE_KB,
                'extensions' => StoreQuoteRequestRequest::ALLOWED_EXTENSIONS,
            ],
        ]);
    }
}
