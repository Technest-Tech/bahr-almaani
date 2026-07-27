<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('projects:scan-deadlines')->everyFiveMinutes();
