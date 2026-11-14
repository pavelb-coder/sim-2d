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
 * Restore structure of the LaserCut Studio activity.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Restores the activity data from a backup file.
 */
class restore_lasercutstudio_activity_structure_step extends restore_activity_structure_step {

    /**
     * Defines the structure to be restored.
     *
     * @return array
     */
    protected function define_structure() {
        $paths = [];
        $userinfo = $this->get_setting_value('userinfo');

        $paths[] = new restore_path_element('lasercutstudio', '/activity/lasercutstudio');

        if ($userinfo) {
            $paths[] = new restore_path_element('lasercutstudio_submission',
                '/activity/lasercutstudio/submissions/submission');
        }

        // Важно: добавляет путь /activity и обработчик process_activity(),
        // который запоминает старый contextid задачи. Без этого не восстановятся файлы.
        return $this->prepare_activity_structure($paths);
    }

    /**
     * Processes one activity instance.
     *
     * @param array $data
     * @return void
     */
    protected function process_lasercutstudio($data) {
        global $DB;

        $data = (object) $data;
        $data->course = $this->get_courseid();
        $data->timecreated = $this->apply_date_offset($data->timecreated);
        $data->timemodified = $this->apply_date_offset($data->timemodified);

        $newitemid = $DB->insert_record('lasercutstudio', $data);
        $this->apply_activity_instance($newitemid);
    }

    /**
     * Processes one submission.
     *
     * @param array $data
     * @return void
     */
    protected function process_lasercutstudio_submission($data) {
        global $DB;

        $data = (object) $data;
        $oldid = $data->id;

        $data->lasercutstudioid = $this->get_new_parentid('lasercutstudio');
        $data->userid = $this->get_mappingid('user', $data->userid);
        $data->timecreated = $this->apply_date_offset($data->timecreated);
        $data->timemodified = $this->apply_date_offset($data->timemodified);

        $newitemid = $DB->insert_record('lasercutstudio_submissions', $data);
        $this->set_mapping('lasercutstudio_submission', $oldid, $newitemid);
    }

    /**
     * Restores files after the structure is in place.
     *
     * @return void
     */
    protected function after_execute() {
        $this->add_related_files('mod_lasercutstudio', 'intro', null);
        // Файлы макета хранятся с itemid = userid, поэтому маппинг не нужен.
        $this->add_related_files('mod_lasercutstudio', 'submission', null);
    }
}
