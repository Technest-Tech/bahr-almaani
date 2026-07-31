<?php

return [
    'submitted' => 'Your request has been received. Your tracking reference is :reference — keep it to follow up on the quote.',
    'not_found' => 'No request found with that reference. Check the code exactly as it was issued to you.',
    'already_converted' => 'This request has already been converted into a project and can no longer be edited.',
    'accept_requires_quote' => 'A request cannot be marked accepted before a quote has been sent.',
    'delete_converted' => 'A request that became a project cannot be deleted.',
    'file_missing' => 'The attachment could not be found on disk.',
    'converted' => 'Project :code was created from this request.',
    'client_note' => 'Created automatically from a website quote request (:reference).',

    'status' => [
        'new' => 'New',
        'reviewing' => 'Under review',
        'quoted' => 'Quote sent',
        'accepted' => 'Accepted',
        'declined' => 'Declined',
        'converted' => 'Converted to project',
    ],

    'public_hint' => [
        'new' => 'We have received your request and it is queued for review. We will come back to you with a quote shortly.',
        'reviewing' => 'Our team is going through your files to work out the cost and turnaround.',
        'quoted' => 'Your quote is ready — you will find it below. Contact us to approve it or ask a question.',
        'accepted' => 'Thank you for approving. We are starting work and will keep you posted.',
        'declined' => 'We could not take this request on. We would be glad to discuss alternatives.',
        'converted' => 'Your request is now an active project with our translation team.',
    ],

    'priority' => [
        'normal' => 'Normal',
        'urgent' => 'Urgent',
        'critical' => 'Critical',
    ],

    'attributes' => [
        'name' => 'name',
        'email' => 'email address',
        'phone' => 'phone number',
        'organization' => 'organisation',
        'title' => 'request title',
        'source_language_id' => 'source language',
        'target_language_id' => 'target language',
        'service_type' => 'service type',
        'priority' => 'priority',
        'declared_pages' => 'approximate page count',
        'needed_by' => 'required by',
        'details' => 'request details',
        'files' => 'attachments',
        'files.*' => 'attachment',
        'quoted_amount' => 'amount',
        'currency' => 'currency',
        'turnaround_days' => 'turnaround',
        'response_note' => 'quote notes',
    ],
];
