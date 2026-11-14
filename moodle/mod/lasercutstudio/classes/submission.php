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
 * Submission model of the LaserCut Studio activity.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace mod_lasercutstudio;

defined('MOODLE_INTERNAL') || die();

/**
 * Stores layouts sent from the editor and grades given by teachers.
 */
class submission {

    /** File area that keeps submitted layouts and attachments. */
    const FILEAREA = 'submission';

    /** Submission states. */
    const STATUS_DRAFT = 'draft';
    const STATUS_SUBMITTED = 'submitted';
    const STATUS_GRADED = 'graded';

    /** Hard limit for a layout sent from the editor (4 MB). */
    const MAX_PROJECT_BYTES = 4194304;

    /** Maximum number of attachments per submission. */
    const MAX_ATTACHMENTS = 5;

    /**
     * Returns the submission record of a user or null.
     *
     * @param int $instanceid
     * @param int $userid
     * @return \stdClass|null
     */
    public static function get($instanceid, $userid) {
        global $DB;

        $record = $DB->get_record('lasercutstudio_submissions', [
            'lasercutstudioid' => (int) $instanceid,
            'userid' => (int) $userid,
        ]);

        return $record ?: null;
    }

    /**
     * Returns all submissions of an instance.
     *
     * @param int $instanceid
     * @return \stdClass[]
     */
    public static function all_for_instance($instanceid) {
        global $DB;

        return $DB->get_records('lasercutstudio_submissions',
            ['lasercutstudioid' => (int) $instanceid], 'timemodified DESC');
    }

    /**
     * Returns files of a submission.
     *
     * @param \context_module $context
     * @param int $userid
     * @return \stored_file[]
     */
    public static function get_files(\context_module $context, $userid) {
        $fs = get_file_storage();

        return $fs->get_area_files($context->id, 'mod_lasercutstudio', self::FILEAREA,
            (int) $userid, 'timemodified DESC', false);
    }

    /**
     * Returns the main layout file of a submission (the .lcx written by the editor).
     *
     * @param \context_module $context
     * @param int $userid
     * @return \stored_file|null
     */
    public static function get_project_file(\context_module $context, $userid) {
        foreach (self::get_files($context, $userid) as $file) {
            if (substr($file->get_filename(), -4) === '.lcx') {
                return $file;
            }
        }
        return null;
    }

    /**
     * Counts objects inside a layout exported by the editor.
     *
     * @param string $project JSON of the document
     * @return int
     */
    public static function count_objects($project) {
        $doc = json_decode((string) $project, true);
        if (!is_array($doc) || empty($doc['order']) || !is_array($doc['order'])) {
            return 0;
        }
        return count($doc['order']);
    }

    /**
     * Saves a layout sent from the editor (and optional attachments).
     *
     * @param \stdClass $instance activity instance
     * @param \context_module $context module context
     * @param int $userid student id
     * @param string $project JSON of the layout
     * @param string $comment student comment
     * @param int $draftitemid draft item id of the filemanager element
     * @return \stdClass saved record
     */
    public static function save($instance, \context_module $context, $userid, $project, $comment = '', $draftitemid = 0) {
        global $DB;

        $now = time();
        $userid = (int) $userid;
        $record = self::get($instance->id, $userid);
        $fs = get_file_storage();

        // Attachments chosen in the form replace the previous ones.
        // Без выбранных файлов (draftitemid = 0) прежние вложения не трогаем:
        // file_save_draft_area_files() обращается к контексту пользователя и на нуле падает.
        if (!empty($draftitemid)) {
            file_save_draft_area_files((int) $draftitemid, $context->id, 'mod_lasercutstudio', self::FILEAREA,
                $userid, ['subdirs' => 0, 'maxfiles' => self::MAX_ATTACHMENTS], '/');
        }

        $project = trim((string) $project);
        $filename = $record ? $record->filename : '';
        $filesize = $record ? (int) $record->filesize : 0;
        $objects = $record ? (int) $record->objectcount : 0;

        if ($project !== '') {
            $filesize = strlen($project);
            if ($filesize > self::MAX_PROJECT_BYTES) {
                throw new \moodle_exception('toobig', 'mod_lasercutstudio', '', round($filesize / 1024));
            }
            $objects = self::count_objects($project);
            $filename = 'layout-' . gmdate('Ymd-His') . '.lcx';

            foreach (self::get_files($context, $userid) as $old) {
                if (substr($old->get_filename(), -4) === '.lcx') {
                    $old->delete();
                }
            }

            $fs->create_file_from_string([
                'contextid' => $context->id,
                'component' => 'mod_lasercutstudio',
                'filearea' => self::FILEAREA,
                'itemid' => $userid,
                'filepath' => '/',
                'filename' => $filename,
                'userid' => $userid,
                'mimetype' => 'application/json',
            ], $project);
        }

        $data = new \stdClass();
        $data->lasercutstudioid = (int) $instance->id;
        $data->userid = $userid;
        $data->status = self::STATUS_SUBMITTED;
        $data->filename = (string) $filename;
        $data->filesize = (int) $filesize;
        $data->objectcount = (int) $objects;
        $data->comment = (string) $comment;
        $data->commentformat = FORMAT_PLAIN;
        $data->timemodified = $now;

        if ($record) {
            $data->id = $record->id;
            if ($record->grade !== null) {
                $data->grade = $record->grade;
            }
            $DB->update_record('lasercutstudio_submissions', $data);
            $submissionid = $record->id;
        } else {
            $data->timecreated = $now;
            $submissionid = $DB->insert_record('lasercutstudio_submissions', $data);
        }

        $event = event\submission_created::create([
            'context' => $context,
            'objectid' => $submissionid,
            'relateduserid' => $userid,
            'other' => [
                'instanceid' => (int) $instance->id,
                'objects' => (int) $objects,
                'filesize' => (int) $filesize,
            ],
        ]);
        $event->trigger();

        return $DB->get_record('lasercutstudio_submissions', ['id' => $submissionid], '*', MUST_EXIST);
    }

    /**
     * Stores a grade for a submission and updates the gradebook.
     *
     * @param \stdClass $instance
     * @param \context_module $context
     * @param \stdClass $submission
     * @param float $grade
     * @return \stdClass updated submission
     */
    public static function set_grade($instance, \context_module $context, $submission, $grade) {
        global $DB, $CFG;
        require_once($CFG->libdir . '/gradelib.php');

        $max = (float) $instance->grade;
        $grade = max(0, min($max, (float) $grade));

        $submission->grade = $grade;
        $submission->status = self::STATUS_GRADED;
        $submission->timemodified = time();
        $DB->update_record('lasercutstudio_submissions', $submission);

        $graderecord = new \stdClass();
        $graderecord->userid = (int) $submission->userid;
        $graderecord->rawgrade = $grade;
        $graderecord->dategraded = $submission->timemodified;

        // grade_update() ожидает массив оценок, ключ — userid.
        \lasercutstudio_grade_item_update($instance, [(int) $submission->userid => $graderecord]);

        $event = event\submission_graded::create([
            'context' => $context,
            'objectid' => $submission->id,
            'relateduserid' => (int) $submission->userid,
            'other' => [
                'instanceid' => (int) $instance->id,
                'grade' => $grade,
                'max' => $max,
            ],
        ]);
        $event->trigger();

        return $submission;
    }

    /**
     * Returns a localised label of the submission status.
     *
     * @param string $status
     * @return string
     */
    public static function status_label($status) {
        $key = 'status_' . $status;
        if (get_string_manager()->string_exists($key, 'mod_lasercutstudio')) {
            return get_string($key, 'mod_lasercutstudio');
        }
        return (string) $status;
    }

    /**
     * Deletes all submissions of a user in the given module context.
     *
     * @param \context_module $context
     * @param int $userid
     * @return void
     */
    public static function delete_for_user(\context_module $context, $userid) {
        global $DB;

        $cm = get_coursemodule_from_id('lasercutstudio', $context->instanceid);
        if (!$cm) {
            return;
        }

        $DB->delete_records('lasercutstudio_submissions', [
            'lasercutstudioid' => (int) $cm->instance,
            'userid' => (int) $userid,
        ]);

        $fs = get_file_storage();
        $fs->delete_area_files($context->id, 'mod_lasercutstudio', self::FILEAREA, (int) $userid);
    }
}
