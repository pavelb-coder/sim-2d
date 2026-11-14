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
 * English strings for the LaserCut Studio activity module.
 *
 * @package    mod_lasercutstudio
 * @copyright  2026 LaserCut Studio
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['attachment'] = 'Layout files';
$string['attachment_help'] = 'Optional: attach the .lcx project or exported DXF/SVG files. Files created by the "Submit to Moodle" button inside the editor are attached automatically.';
$string['comment'] = 'Comment';
$string['downloadproject'] = 'Download layout';
$string['editorheight'] = 'Editor height, px';
$string['editorheight_help'] = 'Height of the embedded editor, in pixels. 600–900 px works well for most screens; the full‑screen button opens the editor in a separate tab.';
$string['editormissing'] = 'Editor build not found';
$string['editormissing_details'] = 'Copy the built editor to moodle/mod/lasercutstudio/editor/index.html (see README in the plugin folder).';
$string['editorheighterror'] = 'Height must be between 320 and 2160 px.';
$string['editorsettings'] = 'Editor';
$string['event_submission_created'] = 'Layout submitted';
$string['event_submission_graded'] = 'Layout graded';
$string['fullscreen'] = 'Full screen';
$string['grade_help'] = 'If a maximum grade is set, teachers can grade submitted layouts. The grade is stored in the course gradebook.';
$string['grades'] = 'Grades';
$string['graded'] = 'Graded';
$string['gradedby'] = 'Graded by';
$string['lasercutstudio:addinstance'] = 'Add a new LaserCut Studio activity';
$string['lasercutstudio:downloadsubmission'] = 'Download submitted layouts';
$string['lasercutstudio:grade'] = 'Grade submitted layouts';
$string['lasercutstudio:submit'] = 'Submit a layout';
$string['lasercutstudio:view'] = 'View the LaserCut Studio activity';
$string['lasercutstudio:viewallsubmissions'] = 'View all submitted layouts';
$string['modulename'] = 'LaserCut Studio';
$string['modulename_help'] = 'The LaserCut Studio activity embeds a vector editor for laser cutting directly into the course: drawings in millimetres 1:1, DXF and SVG import/export, boolean operations, text to curves, nesting and a pre‑cut check. Students edit the layout in the browser and submit it with one button, teachers download the files and grade them.';
$string['modulenameplural'] = 'LaserCut Studio';
$string['nosubmission'] = 'Nothing submitted yet';
$string['nosubmissions'] = 'No submissions yet';
$string['objectcount'] = 'Objects';
$string['openinnewtab'] = 'Open the editor in a new tab';
$string['openinnewtab_help'] = 'Students open the layout editor in a separate browser tab instead of an embedded frame. Useful on small screens.';
$string['pluginadministration'] = 'LaserCut Studio administration';
$string['pluginname'] = 'LaserCut Studio';
$string['privacy:metadata:files'] = 'Layout files (.lcx, DXF, SVG) attached by the student to a submission.';
$string['privacy:metadata:grades'] = 'The grade a teacher gave to the submitted layout.';
$string['privacy:metadata:lasercutstudio_submissions'] = 'Information about the layouts a student submitted.';
$string['privacy:metadata:lasercutstudio_submissions:comment'] = 'Comment written by the student.';
$string['privacy:metadata:lasercutstudio_submissions:filename'] = 'Name of the submitted file.';
$string['privacy:metadata:lasercutstudio_submissions:grade'] = 'Grade given by the teacher.';
$string['privacy:metadata:lasercutstudio_submissions:objectcount'] = 'Number of objects in the submitted layout.';
$string['privacy:metadata:lasercutstudio_submissions:status'] = 'Submission status (draft, submitted, graded).';
$string['privacy:metadata:lasercutstudio_submissions:timecreated'] = 'Time when the layout was submitted.';
$string['privacy:metadata:lasercutstudio_submissions:timemodified'] = 'Time when the submission was modified.';
$string['privacy:metadata:lasercutstudio_submissions:userid'] = 'The user who submitted the layout.';
$string['projectempty'] = 'The editor has not sent a layout yet. Draw something and press "Submit to Moodle" inside the editor.';
$string['savedgrade'] = 'Grade saved';
$string['status'] = 'Status';
$string['status_draft'] = 'Draft';
$string['status_graded'] = 'Graded';
$string['status_submitted'] = 'Submitted';
$string['student'] = 'Student';
$string['submitinstructions'] = 'Draw the layout in millimetres 1:1, check it with the "Pre-cut check" panel, then press "Submit to Moodle" inside the editor and save the submission below.';
$string['submitsave'] = 'Save submission';
$string['submitwork'] = 'Submit layout';
$string['submissionreceived'] = 'Layout received: {$a->objects} objects, {$a->size} KB. Press "Save submission" to hand it in.';
$string['submissionstatus'] = 'Submission';
$string['submittedat'] = 'Submitted';
$string['submittedthanks'] = 'Layout submitted';
$string['submissions'] = 'Submitted layouts';
$string['teacherview'] = 'View all submissions';
$string['timemodified'] = 'Updated';
$string['toobig'] = 'Layout is too large to submit ({$a} KB). Export it as .lcx and attach the file instead.';
$string['viewsubmissions'] = 'Submitted layouts';
$string['editornotready'] = 'Waiting for the editor…';
