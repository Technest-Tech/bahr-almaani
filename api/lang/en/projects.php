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
];
