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
 * Backup task of the LaserCut Studio activity.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/mod/lasercutstudio/backup/moodle2/backup_lasercutstudio_stepslib.php');

/**
 * Provides the steps to perform one complete backup of the activity.
 */
class backup_lasercutstudio_activity_task extends backup_activity_task {

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
        $this->add_step(new backup_lasercutstudio_activity_structure_step('lasercutstudio_structure',
            'lasercutstudio.xml'));
    }

    /**
     * Encodes links to the activity so they can be restored in another course.
     *
     * @param string $content
     * @return string
     */
    public static function encode_content_links($content) {
        global $CFG;

        $base = preg_quote($CFG->wwwroot . '/mod/lasercutstudio', '#');

        $search = [
            '#(' . $base . '/index\.php\?id=)([0-9]+)#',
            '#(' . $base . '/view\.php\?id=)([0-9]+)#',
        ];
        $replace = [
            '$@LASERCUTSTUDIOINDEX*$2@$',
            '$@LASERCUTSTUDIOVIEW*$2@$',
        ];

        return preg_replace($search, $replace, $content);
    }
}
