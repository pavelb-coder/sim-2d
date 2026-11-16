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
 * Event fired when a teacher grades a submitted layout.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_lasercutstudio\event;

defined('MOODLE_INTERNAL') || die();

/**
 * The submission_graded event class.
 */
class submission_graded extends \core\event\base {

    /**
     * Init method.
     *
     * @return void
     */
    protected function init() {
        $this->data['objecttable'] = 'lasercutstudio_submissions';
        $this->data['crud'] = 'u';
        $this->data['edulevel'] = self::LEVEL_TEACHING;
    }

    /**
     * Returns the localised name of the event.
     *
     * @return string
     */
    public static function get_name() {
        return get_string('event_submission_graded', 'mod_lasercutstudio');
    }

    /**
     * Returns the event description.
     *
     * @return string
     */
    public function get_description() {
        return "The user with id '{$this->userid}' graded the layout of the user with id '{$this->relateduserid}' " .
            "for the activity with course module id '{$this->contextinstanceid}'.";
    }

    /**
     * Returns the event URL.
     *
     * @return \moodle_url
     */
    public function get_url() {
        return new \moodle_url('/mod/lasercutstudio/submissions.php', ['id' => $this->contextinstanceid]);
    }

    /**
     * Validates the event data.
     *
     * @return void
     */
    protected function validate_data() {
        parent::validate_data();
        if (!isset($this->relateduserid)) {
            throw new \coding_exception('The relateduserid must be set.');
        }
    }

    /**
     * Maps the submission id when logs are restored.
     *
     * @return array
     */
    public static function get_objectid_mapping() {
        return ['db' => 'lasercutstudio_submissions', 'restore' => 'lasercutstudio_submission'];
    }
}
