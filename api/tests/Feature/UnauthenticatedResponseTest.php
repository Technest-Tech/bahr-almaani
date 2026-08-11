<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * An unauthenticated API request must answer 401, whatever it asked to receive.
 *
 * This app has no `login` route, so Laravel's default guest redirect used to throw
 * RouteNotFoundException while building the AuthenticationException — turning every
 * such request into a 500. Downloads are the case that hit it in production: a
 * browser fetching a file sends `Accept: * / *`, never `application/json`.
 */
class UnauthenticatedResponseTest extends TestCase
{
    public function test_an_api_request_that_did_not_ask_for_json_returns_401(): void
    {
        $this->withHeaders(['Accept' => '*/*'])
            ->get('/api/v1/projects/1/files/1/download')
            ->assertUnauthorized()
            ->assertJson(['message' => 'Unauthenticated.']);
    }

    public function test_an_api_request_asking_for_json_returns_401(): void
    {
        $this->getJson('/api/v1/projects/1/files/1/download')->assertUnauthorized();
    }

    public function test_the_portal_download_route_behaves_the_same(): void
    {
        $this->withHeaders(['Accept' => '*/*'])
            ->get('/api/v1/portal/files/1/download')
            ->assertUnauthorized();
    }
}
