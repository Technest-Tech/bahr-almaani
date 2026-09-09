<?php

return [
    'invalid_transition' => 'Cannot move the project from ":from" to ":to".',
    'note_required' => 'A reason is required for this action.',
    'transition_forbidden' => 'You are not allowed to perform this action.',
    'system_transition_only' => 'This action is performed automatically by the system.',
    'actor_required' => 'This action requires an authenticated user.',
    'publish_requires_source' => 'The project cannot be published without at least one work file.',
    'edit_draft_only' => 'Core project data can only be edited while in draft.',
    'source_upload_draft_only' => 'Work files can only be added while in draft.',
    'file_delete_draft_only' => 'Files can only be deleted while in draft.',
    'manual_count_not_applicable' => 'Manual counting is only available for files that could not be counted automatically.',
    'merge_retry_not_applicable' => 'The merge can only be retried on approved projects whose final file has not been issued.',
    'final_file_missing' => 'This project has no final file yet.',

    // Asking the client for a document (identity papers or supporting material)
    'document_request_settled' => 'Documents cannot be requested once the project is closed.',
    'document_request_duplicate' => 'An open request for this document already exists on that file.',
    'document_request_closed' => 'This request is no longer open.',
    'document_request_cancelled' => 'The document request was cancelled.',
    'document_supplied' => 'The document was uploaded and sent to the office.',
    'document_request_not_fulfilled' => 'A replacement can only be asked for once a document has arrived.',
    'document_delete_settled' => 'Documents cannot be deleted once the project is closed.',
    'document_deleted' => 'The document was deleted; you can upload another.',
    'document_kind' => [
        'identity' => 'Proof of identity',
        'supporting' => 'Supporting document',
    ],
    'status' => [
        'draft' => 'Draft',
        'available' => 'Available',
        'claimed' => 'In progress',
        'delivered' => 'Delivered',
        'in_review' => 'In review',
        'revision_requested' => 'Revision requested',
        'approved' => 'Approved',
        'completed' => 'Completed',
        'archived' => 'Archived',
        'cancelled' => 'Cancelled',
    ],

    'revision_attachment' => 'attachment',
];
