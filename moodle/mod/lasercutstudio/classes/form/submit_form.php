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
 * Submission form of the LaserCut Studio activity.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_lasercutstudio\form;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->libdir . '/formslib.php');

/**
 * Form used by students to hand in a layout.
 */
class submit_form extends \moodleform {

    /**
     * Form definition.
     *
     * @return void
     */
    protected function definition() {
        $mform = $this->_form;

        $mform->addElement('hidden', 'id');
        $mform->setType('id', PARAM_INT);

        $mform->addElement('hidden', 'project');
        $mform->setType('project', PARAM_RAW);
        $mform->setDefault('project', '');

        $mform->addElement('filemanager', 'attachments', get_string('attachment', 'mod_lasercutstudio'), null, [
            'subdirs' => 0,
            'maxbytes' => \mod_lasercutstudio\submission::MAX_PROJECT_BYTES,
            'maxfiles' => \mod_lasercutstudio\submission::MAX_ATTACHMENTS,
            'accepted_types' => ['.lcx', '.dxf', '.svg'],
        ]);
        $mform->addHelpButton('attachments', 'attachment', 'mod_lasercutstudio');

        $mform->addElement('textarea', 'comment', get_string('comment', 'mod_lasercutstudio'),
            ['rows' => 3, 'cols' => 60]);
        $mform->setType('comment', PARAM_TEXT);

        $this->add_action_buttons(false, get_string('submitsave', 'mod_lasercutstudio'));
    }

    /**
     * Form validation.
     *
     * @param array $data
     * @param array $files
     * @return array
     */
    public function validation($data, $files) {
        $errors = parent::validation($data, $files);

        $project = isset($data['project']) ? trim($data['project']) : '';
        if ($project !== '' && strlen($project) > \mod_lasercutstudio\submission::MAX_PROJECT_BYTES) {
            $errors['project'] = get_string('toobig', 'mod_lasercutstudio', round(strlen($project) / 1024));
        }

        return $errors;
    }
}
