<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Restore task of the LaserCut Studio activity.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/lasercutstudio/backup/moodle2/restore_lasercutstudio_stepslib.php');

/**
 * Restores one complete backup of the activity.
 */
class restore_lasercutstudio_activity_task extends restore_activity_task {

    /**
     * No specific settings for this activity.
     *
     * @return void
     */
    protected function define_my_settings() {
    }

    /**
     * Defines the structure step.
     *
     * @return void
     */
    protected function define_my_steps() {
        $this->add_step(new restore_lasercutstudio_activity_structure_step('lasercutstudio_structure',
            'lasercutstudio.xml'));
    }

    /**
     * Contents that need link decoding.
     *
     * @return restore_decode_content[]
     */
    public static function define_decode_contents() {
        return [
            new restore_decode_content('lasercutstudio', ['intro'], 'lasercutstudio'),
        ];
    }

    /**
     * Rules that need link decoding.
     *
     * @return restore_decode_rule[]
     */
    public static function define_decode_rules() {
        return [
            new restore_decode_rule('LASERCUTSTUDIOVIEW', '/mod/lasercutstudio/view.php?id=$1', 'course_module'),
            new restore_decode_rule('LASERCUTSTUDIOINDEX', '/mod/lasercutstudio/index.php?id=$1', 'course'),
        ];
    }
}
